#!/usr/bin/env python3
"""Evaluate one visible BOSS job card against local rules.

Inputs are JSON files. This script intentionally uses only Python stdlib so the
skill can run without dependency installation.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


FIELD_ALIASES = {
    "cities": "city",
    "title": "title",
    "employment_types": "employment_type",
    "company_sizes": "company_size",
    "financing_stages": "financing_stage",
    "company_name": "company_name",
}


def load_json(path: str) -> dict[str, Any]:
    try:
      data = json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - CLI should return actionable JSON.
      print(json.dumps({"ok": False, "error": f"failed to read {path}: {exc}"}, ensure_ascii=False))
      sys.exit(2)
    if not isinstance(data, dict):
      print(json.dumps({"ok": False, "error": f"{path} must contain a JSON object"}, ensure_ascii=False))
      sys.exit(2)
    return data


def norm(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip().lower()


def contains_any(field_value: Any, needles: Any) -> bool:
    haystack = norm(field_value)
    if not isinstance(needles, list):
        return False
    return any(norm(item) in haystack for item in needles if norm(item))


def condition_matches(job: dict[str, Any], conditions: dict[str, Any]) -> bool:
    for key, expected in conditions.items():
        if key.endswith("_any"):
            logical_field = key[: -len("_any")]
            job_field = FIELD_ALIASES.get(logical_field, logical_field)
            if not contains_any(job.get(job_field), expected):
                return False
            continue
        if key.endswith("_none"):
            logical_field = key[: -len("_none")]
            job_field = FIELD_ALIASES.get(logical_field, logical_field)
            if contains_any(job.get(job_field), expected):
                return False
            continue
        else:
            return False
    return True


def exclusion_matches(job: dict[str, Any], exclusions: dict[str, Any]) -> tuple[bool, str | None]:
    for key, expected in exclusions.items():
        if not key.endswith("_any"):
            continue
        logical_field = key[: -len("_any")]
        job_field = FIELD_ALIASES.get(logical_field, logical_field)
        if contains_any(job.get(job_field), expected):
            return True, f"excluded_by_{key}"
    return False, None


def evaluate(rules_doc: dict[str, Any], job: dict[str, Any]) -> dict[str, Any]:
    default_action = rules_doc.get("default_action", "review")
    rules = rules_doc.get("rules", [])
    if not isinstance(rules, list):
        return {"ok": False, "error": "rules must be a list"}

    sorted_rules = sorted(
        (r for r in rules if isinstance(r, dict)),
        key=lambda r: int(r.get("priority", 0)),
        reverse=True,
    )

    for rule in sorted_rules:
        excluded, exclude_reason = exclusion_matches(job, rule.get("exclude", {}) or {})
        if excluded:
            return {
                "ok": True,
                "action": "skip",
                "rule": rule.get("name", "unnamed"),
                "reason": exclude_reason,
            }

        if condition_matches(job, rule.get("match", {}) or {}):
            return {
                "ok": True,
                "action": rule.get("action", "review"),
                "rule": rule.get("name", "unnamed"),
                "reason": "matched_rule",
            }

    return {
        "ok": True,
        "action": default_action,
        "rule": None,
        "reason": "no_rule_matched",
    }


def main() -> int:
    if len(sys.argv) != 3:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "usage: evaluate_job.py <rules.json> <job.json>",
                },
                ensure_ascii=False,
            )
        )
        return 2

    rules_doc = load_json(sys.argv[1])
    job = load_json(sys.argv[2])
    print(json.dumps(evaluate(rules_doc, job), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
