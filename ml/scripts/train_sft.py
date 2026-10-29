"""#75: supervised fine-tuning on the #74 training set, on a local CUDA GPU.

Usage (from ml/, after `uv sync --group train`):
  uv run python scripts/train_sft.py configs/train/lfm2.5-350m-full.yaml
  uv run python scripts/train_sft.py configs/train/lfm2.5-350m-full.yaml --max-steps 5  # smoke

The model is saved to ml/checkpoints/<name>/final (gitignored; #76 exports it to GGUF). What
documents the run is committed to results/train/<name>/: the resolved config, the
validation ids, every logged loss, a loss curve and a summary (GPU, versions, wall time).
"""

from __future__ import annotations

import argparse
import json
import platform
import sys
import time
from pathlib import Path

import yaml

ML = Path(__file__).resolve().parents[1]
ROOT = ML.parent
sys.path.insert(0, str(ML))

from jobtrail_ml import sft  # noqa: E402


def load_config(path: Path) -> dict:
    cfg = yaml.safe_load(path.read_text(encoding="utf-8"))
    if cfg["mode"] not in ("full", "lora"):
        raise SystemExit(f"mode must be full or lora, not {cfg['mode']!r}")
    if cfg["mode"] == "lora" and "lora" not in cfg:
        raise SystemExit("mode lora needs a lora: {r, alpha, dropout, targets} block")
    return cfg


def keep_base_config(cfg: dict, out: Path) -> None:
    """Put the base model's config.json back next to the fine-tuned weights.

    Fine-tuning changes weights, not the architecture, but transformers 5 re-saves the config
    in its own vocabulary: Granite 4.0-H's layer types become full_attention/linear_attention,
    which llama.cpp b9837's converter doesn't know, so every layer exported as Mamba and the
    GGUF failed to load. The base config is the one the converter supports."""
    from huggingface_hub import hf_hub_download

    src = hf_hub_download(cfg["base"], "config.json", revision=cfg["revision"])
    (out / "config.json").write_bytes(Path(src).read_bytes())


def loss_svg(history: list[dict], width: int = 640, height: int = 320) -> str:
    """Training loss (line) and validation loss (dots) against the step."""
    train = [(h["step"], h["loss"]) for h in history if "loss" in h]
    val = [(h["step"], h["eval_loss"]) for h in history if "eval_loss" in h]
    pts = train + val
    if not pts:
        return ""
    x1, y1 = max(s for s, _ in pts) or 1, max(v for _, v in pts) or 1
    pad = 40

    def xy(s: float, v: float) -> str:
        x = pad + s / x1 * (width - 2 * pad)
        return f"{x:.1f},{height - pad - v / y1 * (height - 2 * pad):.1f}"

    line = " ".join(xy(s, v) for s, v in train)
    dots = "".join(f'<circle cx="{xy(s, v).split(",")[0]}" cy="{xy(s, v).split(",")[1]}" '
                   f'r="4" fill="#d9480f"/>' for s, v in val)  # fmt: skip
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'font-family="sans-serif" font-size="12">'
        f'<rect width="{width}" height="{height}" fill="white"/>'
        f'<line x1="{pad}" y1="{height - pad}" x2="{width - pad}" y2="{height - pad}" '
        f'stroke="#888"/><line x1="{pad}" y1="{pad}" x2="{pad}" y2="{height - pad}" stroke="#888"/>'
        f'<text x="{pad}" y="{pad - 10}">loss (max {y1:.2f}); '
        f"line = train, dots = validation</text>"
        f'<text x="{width - pad}" y="{height - 10}" text-anchor="end">step {x1}</text>'
        f'<polyline points="{line}" fill="none" stroke="#1c7ed6" stroke-width="2"/>{dots}</svg>\n'
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("config", type=Path)
    ap.add_argument("--max-steps", type=int, default=-1, help="stop early (smoke test)")
    args = ap.parse_args()
    cfg = load_config(args.config)

    import torch
    import transformers
    import trl
    from datasets import Dataset
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from trl import SFTConfig, SFTTrainer

    if not torch.cuda.is_available():
        raise SystemExit("no CUDA GPU: run `uv sync --group train` on a machine with one")
    rows = sft.load_rows(ROOT / cfg["data"])
    train_rows, val_rows = sft.split_validation(rows, cfg["val_frac"], cfg["seed"])
    if set(sft.ids(train_rows)) & set(sft.ids(val_rows)):
        raise SystemExit("split_validation returned a note in both train and validation")

    tok = AutoTokenizer.from_pretrained(cfg["base"], revision=cfg["revision"])

    def n_tokens(e: dict) -> int:
        ids = tok.apply_chat_template(e["prompt"] + e["completion"], tokenize=True,
                                      return_dict=True)["input_ids"]  # fmt: skip
        return len(ids)

    longest = max(n_tokens(sft.to_example(r, cfg["format"])) for r in rows)
    if longest > cfg["max_length"]:
        raise SystemExit(f"an example is {longest} tokens; raise max_length ({cfg['max_length']})")

    def dataset(part: list[dict]) -> Dataset:
        return Dataset.from_list([sft.to_example(r, cfg["format"]) for r in part])

    model = AutoModelForCausalLM.from_pretrained(
        cfg["base"], revision=cfg["revision"], dtype=torch.bfloat16
    )
    peft_config = None
    if cfg["mode"] == "lora":
        from peft import LoraConfig

        lc = cfg["lora"]
        peft_config = LoraConfig(r=lc["r"], lora_alpha=lc["alpha"], lora_dropout=lc["dropout"],
                                 target_modules=lc["targets"], task_type="CAUSAL_LM")  # fmt: skip

    name = cfg["name"] + ("-smoke" if args.max_steps > 0 else "")
    out_ckpt, out_res = ML / "checkpoints" / name, ROOT / "results" / "train" / name
    targs = SFTConfig(
        output_dir=str(out_ckpt),
        num_train_epochs=cfg["epochs"],
        max_steps=args.max_steps,
        learning_rate=cfg["learning_rate"],
        lr_scheduler_type=cfg["scheduler"],
        warmup_steps=cfg["warmup_ratio"],  # transformers 5: a float < 1 is a ratio of the steps
        weight_decay=cfg["weight_decay"],
        per_device_train_batch_size=cfg["batch_size"],
        per_device_eval_batch_size=cfg["batch_size"],
        gradient_accumulation_steps=cfg["grad_accum"],
        max_length=cfg["max_length"],
        completion_only_loss=True,
        # No candidate has experts. Granite 4.0-H-350M's config is the MoE-hybrid class (0 experts,
        # coefficient 0.01), which would switch on TRL's load-balancing loss and fail.
        router_aux_loss_coef=0.0,
        bf16=True,
        logging_steps=5,
        eval_strategy="epoch",
        save_strategy="no",
        seed=cfg["seed"],
        data_seed=cfg["seed"],
        report_to="none",
    )
    trainer = SFTTrainer(model=model, args=targs, train_dataset=dataset(train_rows),
                         eval_dataset=dataset(val_rows), processing_class=tok,
                         peft_config=peft_config)  # fmt: skip
    torch.cuda.reset_peak_memory_stats()
    start = time.time()
    trainer.train()
    wall = time.time() - start
    final = trainer.model.merge_and_unload() if peft_config else trainer.model
    final.save_pretrained(out_ckpt / "final")
    tok.save_pretrained(out_ckpt / "final")
    keep_base_config(cfg, out_ckpt / "final")

    out_res.mkdir(parents=True, exist_ok=True)
    history = trainer.state.log_history

    def write(name: str, text: str) -> None:  # LF on Windows too, like the rest of the repo
        (out_res / name).write_text(text, encoding="utf-8", newline="\n")

    write("config.yaml", yaml.safe_dump(cfg, sort_keys=False))
    write("log_history.json", json.dumps(history, indent=2) + "\n")
    write("loss.svg", loss_svg(history))
    evals = [h["eval_loss"] for h in history if "eval_loss" in h]
    summary = {
        "issue": 75, "name": name, "base": cfg["base"], "revision": cfg["revision"],
        "mode": cfg["mode"], "train": len(train_rows), "validation": len(val_rows),
        "validationIds": sft.ids(val_rows), "longestExampleTokens": longest,
        "steps": trainer.state.global_step, "wallSeconds": round(wall, 1),
        "finalTrainLoss": next((h["loss"] for h in reversed(history) if "loss" in h), None),
        "evalLoss": evals,
        "peakGpuMemoryGiB": round(torch.cuda.max_memory_allocated() / 2**30, 2),
        "gpu": torch.cuda.get_device_name(0), "torch": torch.__version__,
        "cuda": torch.version.cuda, "transformers": transformers.__version__,
        "trl": trl.__version__, "python": platform.python_version(),
    }  # fmt: skip
    write("summary.json", json.dumps(summary, indent=2) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k != "validationIds"}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
