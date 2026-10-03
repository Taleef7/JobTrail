"""#71 step 2: turn the drafts + one decision per draft into frozen test/dev sets.

Every draft needs exactly one decision whose draftHash still matches (the note and
key the reviewer saw). Accepted and edited drafts are kept; rejected ones are
dropped. A record is `verified` only when a human made its decision; the owner
declined manual review (2026-10-02), so the decisions come from the cross-family
model adjudication in adjudicate.py and every record says so in `review`.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from collections import Counter
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

SCHEMA_PATH = (
    Path(__file__).resolve().parents[2] / "packages" / "core" / "schema" / "schema.v2.json"
)
GOLD_KEYS = ("jobType", "workPerformed", "issuesFound", "materials", "laborMinutes",
             "customerApproved", "followUps")  # fmt: skip
MATERIAL_KEYS = ("name", "quantity", "unit")
RECORD_KEYS = ("id", "note", "gold", "source", "tags", "verified")


def _num(v: Any) -> Any:
    # JSON.stringify writes 90.0 as 90.
    return int(v) if isinstance(v, float) and v.is_integer() else v


def _canonical(gold: dict[str, Any]) -> dict[str, Any]:
    """The key order the label page serializes in (schema v2 order)."""
    out = {k: gold[k] for k in GOLD_KEYS}
    out["materials"] = [{k: _num(m[k]) for k in MATERIAL_KEYS} for m in gold["materials"]]
    out["laborMinutes"] = _num(gold["laborMinutes"])
    return out


def draft_hash(item: dict[str, Any]) -> str:
    """FNV-1a 32-bit over UTF-16 code units of note + "\\n" + JSON(gold), as in label.ts."""
    s = item["note"] + "\n" + json.dumps(_canonical(item["gold"]), ensure_ascii=False,
                                          separators=(",", ":"))  # fmt: skip
    data = s.encode("utf-16-le")
    h = 0x811C9DC5
    for i in range(0, len(data), 2):
        h ^= data[i] | (data[i + 1] << 8)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def _validator() -> Draft202012Validator:
    return Draft202012Validator(json.loads(SCHEMA_PATH.read_text(encoding="utf-8")))


METHODS = ("human", "adjudicated")


def _check(drafts, decisions) -> dict[str, dict]:
    by_draft = {d["id"]: d for d in drafts}
    by_id: dict[str, dict] = {}
    for x in decisions:
        if x["id"] in by_id:
            raise ValueError(f"duplicate decision {x['id']}")
        if x["id"] not in by_draft:
            raise ValueError(f"{x['id']} is not a draft")
        if x["draftHash"] != draft_hash(by_draft[x["id"]]):
            raise ValueError(f"{x['id']}: the draft changed since it was reviewed")
        if x["action"] not in ("accept", "edit", "reject"):
            raise ValueError(f"{x['id']}: unknown action {x['action']}")
        if x.get("method", "human") not in METHODS:
            raise ValueError(f"{x['id']}: unknown review method {x['method']}")
        by_id[x["id"]] = x
    missing = sorted(set(by_draft) - set(by_id))
    if missing:
        raise ValueError(f"no decision for {', '.join(missing[:10])}")
    validator = _validator()
    for x in by_id.values():
        if x["action"] == "edit":
            errors = sorted(validator.iter_errors(x["gold"]), key=lambda e: list(e.path))
            if errors:
                where = "/".join(map(str, errors[0].path)) or "(root)"
                raise ValueError(f"{x['id']}: edited key invalid at {where}: {errors[0].message}")
    return by_id


def apply_decisions(drafts: list[dict], decisions: list[dict]) -> dict:
    by_id = _check(drafts, decisions)
    out: dict[str, Any] = {"test": [], "dev": [], "rejected": []}
    for d in sorted(drafts, key=lambda d: d["id"]):
        split = d["meta"]["split"]
        x = by_id[d["id"]]
        if x["action"] == "reject":
            out["rejected"].append({"id": d["id"], "split": split, "comment": x["comment"]})
            continue
        method = x.get("method", "human")
        rec = {k: d[k] for k in RECORD_KEYS}
        rec["gold"] = x["gold"] if x["action"] == "edit" else d["gold"]
        rec["verified"] = method == "human"
        rec["review"] = {
            "method": method,
            "action": x["action"],
            "reasons": x.get("reasons", []),
            "reviewedAt": x["reviewedAt"],
        }
        if x["comment"]:
            rec["review"]["comment"] = x["comment"]
        if "votes" in x:
            rec["review"]["votes"] = {r: v["action"] for r, v in x["votes"].items()}
        if "override" in x:
            rec["review"]["override"] = x["override"]["reason"]
        out[split].append(rec)
    return out


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """95% Wilson score interval for k successes in n trials."""
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, center - margin), min(1.0, center + margin))


def review_stats(drafts: list[dict], decisions: list[dict]) -> dict:
    """Outcomes overall and by why a draft was suspect: a fidelity flag (#70), a panel
    problem (#71 step 1), or nothing (clean). How often a clean draft still changed
    estimates the error rate of drafts no check flagged."""
    by_id = _check(drafts, decisions)
    drafts_by_id = {d["id"]: d for d in drafts}
    actions = Counter(x["action"] for x in by_id.values())
    by_reason: dict[str, dict[str, int]] = {}
    for x in by_id.values():
        for r in x.get("reasons") or ["clean"]:
            row = by_reason.setdefault(r, {"n": 0, "accept": 0, "edit": 0, "reject": 0})
            row["n"] += 1
            row[x["action"]] += 1
    fields = Counter(
        k
        for x in by_id.values()
        if x["action"] == "edit"
        for k in GOLD_KEYS
        if x["gold"][k] != drafts_by_id[x["id"]]["gold"][k]
    )
    clean = by_reason.get("clean", {"n": 0, "edit": 0, "reject": 0})
    k, n = clean["edit"] + clean["reject"], clean["n"]
    lo, hi = wilson(k, n)
    return {
        "drafts": len(drafts),
        "accepted": actions["accept"],
        "edited": actions["edit"],
        "rejected": actions["reject"],
        "by_reason": dict(sorted(by_reason.items())),
        "fields_edited": dict(sorted(fields.items())),
        "clean_changed": {"k": k, "n": n, "rate": k / n if n else None, "ci95": [lo, hi]},
        "methods": dict(Counter(x.get("method", "human") for x in by_id.values())),
    }


# ---------------------------------------------------------------- frozen files

FROZEN_ROW = re.compile(
    r"^\|\s*`data/([\w./-]+)`\s*\|\s*(\d+)\s*\|\s*`([0-9a-f]{64})`\s*\|\s*$", re.M
)


def frozen_rows(frozen_md: str) -> list[tuple[str, int, str]]:
    """(file under data/, record count, sha256) for each row of FROZEN.md's table."""
    return [(name, int(n), digest) for name, n, digest in FROZEN_ROW.findall(frozen_md)]


def check_frozen(data_dir: Path) -> list[str]:
    """Problems with the frozen files listed in data_dir/FROZEN.md; empty when all is well."""
    rows = frozen_rows((data_dir / "FROZEN.md").read_text(encoding="utf-8"))
    if not rows:
        return ["FROZEN.md lists no files"]
    validator = _validator()
    problems: list[str] = []
    seen: dict[str, str] = {}
    for name, count, digest in rows:
        path = data_dir / name
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            problems.append(f"data/{name} changed since it was frozen")
        records = [
            json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line
        ]
        if len(records) != count:
            problems.append(f"data/{name}: {len(records)} records, FROZEN.md says {count}")
        for r in records:
            if r["id"] in seen:
                problems.append(f"{r['id']} is in both data/{seen[r['id']]} and data/{name}")
            seen[r["id"]] = name
            if any(True for _ in validator.iter_errors(r["gold"])):
                problems.append(f"{r['id']}: gold fails schema v2")
            if r.get("verified") is not (r.get("review", {}).get("method") == "human"):
                problems.append(f"{r['id']}: verified must be true exactly for human review")
    return problems
