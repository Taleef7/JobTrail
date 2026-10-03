"""#72: run configs, deterministic run IDs, resumable run folders, cost."""

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from jobtrail_ml.runs import (
    ConfigError,
    Run,
    cost,
    gemini_usage,
    load_config,
    resolve,
    run_id,
    score_run,
)

ML = Path(__file__).resolve().parents[1]
GOLD = {"jobType": "plumbing", "workPerformed": ["Replaced P-trap"], "issuesFound": [],
        "materials": [{"name": "PVC P-trap kit", "quantity": 1, "unit": "kit"}],
        "laborMinutes": 90, "customerApproved": True, "followUps": []}  # fmt: skip
SHA = "a" * 64


@pytest.fixture
def gold(tmp_path):
    path = tmp_path / "dev.jsonl"
    rows = [{"id": f"d-{i}", "note": f"Replaced the P-trap, used 1 PVC P-trap kit. Note {i}.",
             "gold": GOLD, "source": "synthetic", "tags": []} for i in range(1, 4)]  # fmt: skip
    path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    return path


def local(gold_path, **kw):
    raw = {"name": "m", "provider": "llamacpp", "gold": str(gold_path),
           "model": {"file": "ml/models/m.gguf", "url": "https://x/m.gguf",
                     "sha256": SHA}}  # fmt: skip
    return resolve({**raw, **kw})


def cloud(gold_path, **kw):
    return resolve({"name": "g", "provider": "gemini", "gold": str(gold_path),
                    "model": {"id": "gemini-3.8-flash"}, **kw})  # fmt: skip


def test_defaults_fill_in_and_keys_come_out_in_a_fixed_order(gold):
    cfg = local(gold)
    assert list(cfg) == ["name", "provider", "model", "prompt", "format", "grammar", "gold",
                         "limit", "sampling", "server"]  # fmt: skip
    assert (cfg["prompt"], cfg["format"], cfg["grammar"]) == ("zero-shot", "full", True)
    assert cfg["sampling"] == {"temperature": 0.0, "seed": 42, "max_tokens": 512}
    assert cfg["server"]["gpu_layers"] == 0


def test_cloud_defaults_leave_output_uncapped_and_refuse_few_shot(gold):
    cfg = cloud(gold)
    assert cfg["sampling"]["max_tokens"] is None and cfg["cloud"]["key_env"] == "GEMINI_API_KEY"
    with pytest.raises(ConfigError, match="few-shot"):
        cloud(gold, prompt="few-shot")


@pytest.mark.parametrize(
    ("change", "message"),
    [({"provider": "ollama"}, "provider"), ({"prompt": "cot"}, "prompt"),
     ({"format": "yaml"}, "format"), ({"limit": 0}, "limit"), ({"temprature": 0}, "unknown"),
     ({"prompt": "fine-tuned-short"}, "compact"), ({"model": {"file": "x"}}, "sha256")],
)  # fmt: skip
def test_bad_configs_are_refused(gold, change, message):
    with pytest.raises(ConfigError, match=message):
        local(gold, **change)


def test_run_id_is_deterministic_and_tracks_everything_that_changes_output(gold, tmp_path):
    base = run_id(local(gold))
    assert re.fullmatch(r"m-dev-[0-9a-f]{8}", base)
    assert run_id(local(gold)) == base
    same = [local(gold, model={"file": "elsewhere.gguf", "url": "https://mirror/m", "sha256": SHA}),
            local(gold, server={"threads": 8})]  # fmt: skip
    assert {run_id(c) for c in same} == {base}
    changed = [local(gold, sampling={"temperature": 0.7}), local(gold, prompt="few-shot"),
               local(gold, grammar=False), local(gold, limit=2), local(gold, format="compact"),
               local(gold, model={"file": "m.gguf", "sha256": "b" * 64}),
               local(gold, server={"gpu_layers": 99})]  # fmt: skip
    ids = [run_id(c) for c in changed]
    assert base not in ids and len(set(ids)) == len(ids)
    gold.write_text(gold.read_text(encoding="utf-8") + "\n", encoding="utf-8")
    assert run_id(local(gold)) != base  # the gold file's bytes are part of the identity


def test_cloud_pricing_rate_limits_and_key_name_stay_out_of_the_run_id(gold):
    a = cloud(gold)
    b = cloud(gold, cloud={"rpm": 2, "key_env": "OTHER", "pricing": {"rates": []}})
    assert run_id(a) == run_id(b)
    assert run_id(a) != run_id(cloud(gold, cloud={"thinking_level": "high"}))


def test_a_saved_config_json_reproduces_the_same_run(gold, tmp_path):
    cfg = local(gold, limit=2)
    run = Run(cfg, tmp_path / "runs")
    run.open({"runtime": "llama.cpp b1"})
    again = load_config(run.dir / "config.json")
    assert again == cfg and run_id(again) == run.id


def line(i, raw="{}"):
    return {"id": f"d-{i}", "raw": raw, "format": "full", "model": "m"}


def test_runs_append_and_resume_where_they_stopped(gold, tmp_path):
    run = Run(local(gold), tmp_path)
    run.open({"runtime": "llama.cpp b1"})
    run.append(line(1))
    with run.pred_path.open("a", encoding="utf-8") as f:
        f.write('{"id": "d-2", "ra')  # crash mid-write
    again = Run(local(gold), tmp_path)
    assert [g["id"] for g in again.todo()] == ["d-2", "d-3"]
    assert run.pred_path.read_text(encoding="utf-8") == json.dumps(line(1)) + "\n"


def test_resuming_with_a_different_runtime_build_is_refused(gold, tmp_path):
    run = Run(local(gold), tmp_path)
    run.open({"runtime": "llama.cpp b1"})
    run.append(line(1))
    with pytest.raises(RuntimeError, match="delete the folder"):
        Run(local(gold), tmp_path).open({"runtime": "llama.cpp b2"})


def test_limit_takes_the_first_notes_and_saves_that_gold_subset(gold, tmp_path):
    run = Run(local(gold, limit=2), tmp_path)
    run.open({"runtime": "x"})
    saved = [json.loads(x)["id"] for x in (run.dir / "gold.jsonl").read_text().splitlines()]
    assert saved == ["d-1", "d-2"] and [g["id"] for g in run.todo()] == ["d-1", "d-2"]


def test_an_unfinished_run_is_not_scored(gold, tmp_path):
    run = Run(local(gold), tmp_path)
    run.open({"runtime": "x"})
    run.append(line(1))
    assert run.finish("incomplete") is None
    meta = json.loads((run.dir / "run.json").read_text(encoding="utf-8"))
    assert meta["status"] == "incomplete" and meta["predictions"] == 1
    with pytest.raises(RuntimeError, match="2 notes have no prediction"):
        score_run(run.dir)


def test_cost_bills_thinking_as_output_at_every_published_rate():
    pricing = {"rates": [
        {"label": "2026", "input_per_mtok": 0.75, "output_per_mtok": 3.75},
        {"label": "2027", "input_per_mtok": 1.5, "output_per_mtok": 7.5},
    ]}  # fmt: skip
    usage = {"promptTokens": 1_000_000, "outputTokens": 100_000, "thoughtsTokens": 100_000}
    got = cost(usage, pricing, n=4)
    assert got[0] == {"rate": "2026", "usd": 1.5, "usdPerNote": 0.375}
    assert got[1]["usd"] == 3.0
    assert cost(usage, None, 4) == []


def test_gemini_usage_maps_the_api_counts():
    meta = {"promptTokenCount": 900, "candidatesTokenCount": 120, "thoughtsTokenCount": 300}
    assert gemini_usage(meta) == {"promptTokens": 900, "outputTokens": 120,
                                  "thoughtsTokens": 300}  # fmt: skip
    assert gemini_usage({})["thoughtsTokens"] == 0


def test_every_committed_config_resolves():
    configs = sorted((ML / "configs").glob("*.yaml"))
    assert configs
    for path in configs:
        cfg = load_config(path)
        assert cfg["name"] == path.stem, path.name
        if cfg["provider"] == "llamacpp":
            assert re.fullmatch(r"[0-9a-f]{64}", cfg["model"]["sha256"]), path.name
            assert cfg["model"]["url"].startswith("https://huggingface.co/"), path.name
            assert cfg["sampling"]["temperature"] == 0 and cfg["server"]["gpu_layers"] == 0
        else:
            assert cfg["cloud"]["pricing"]["rates"], path.name


def _node24() -> bool:
    if not shutil.which("node"):
        return False
    v = subprocess.run(["node", "--version"], capture_output=True, text=True).stdout
    return int(v.lstrip("v").split(".")[0]) >= 24


@pytest.mark.skipif(not _node24(), reason="the core scorer needs node >= 24")
def test_a_complete_run_is_scored_by_the_core_scorer(gold, tmp_path):
    run = Run(local(gold), tmp_path)
    run.open({"runtime": "x"})
    for i in (1, 2, 3):
        run.append(line(i, raw=json.dumps(GOLD) if i < 3 else "not json"))
    report = run.finish("incomplete")
    assert report["run"] == run.id and report["overall"]["n"] == 3
    assert report["overall"]["zeroEditRate"] == pytest.approx(2 / 3)
    assert json.loads((run.dir / "report.json").read_text(encoding="utf-8")) == report
