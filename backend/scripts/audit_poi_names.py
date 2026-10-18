"""Read-only name/provenance audit. Run: python -m backend.scripts.audit_poi_names."""

import argparse
import json
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

from backend.services.poi_names import NAME_KEYS, meaningful_name, safe_display_name

ROOT = Path(__file__).resolve().parents[2]


def _name_tags(tags: dict) -> dict:
    return {key: tags[key] for key in NAME_KEYS if key in tags}


def _has_name_tag(tags: dict) -> bool:
    return any(isinstance(tags.get(key), str) and tags[key].strip() for key in NAME_KEYS)


def _percent(count: int, total: int) -> float:
    return round(100 * count / total, 4) if total else 0.0


def build_report(database_path: Path, cache_path: Path, snapshot_path: Path) -> dict:
    """Inspect all rows and source names without modifying any input."""
    with closing(sqlite3.connect(database_path.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        db.row_factory = sqlite3.Row
        rows = [dict(row) for row in db.execute("SELECT id, name, tags_json FROM poi ORDER BY id")]
    affected, mismatches, missing, excluded, renamed = [], 0, 0, 0, 0
    for row in rows:
        tags = json.loads(row["tags_json"])
        name = safe_display_name(row["name"], tags)
        missing += not _has_name_tag(tags)
        mismatches += row["name"] not in [
            value.strip() for value in _name_tags(tags).values() if isinstance(value, str)
        ]
        if name != row["name"]:
            excluded += name is None
            renamed += name is not None
            affected.append(
                {
                    "id": row["id"],
                    "stored_name": row["name"],
                    "safe_name": name,
                    "name_tags": _name_tags(tags),
                    "reference_tags": {
                        key: tags[key] for key in ("ref", "id", "local_ref") if key in tags
                    },
                    "action": "skip" if name is None else "use_meaningful_name_tag",
                }
            )

    cache = json.loads(cache_path.read_text(encoding="utf-8"))
    elements = cache.get("payload", cache)["elements"]
    cache_missing = sum(not _has_name_tag(item.get("tags", {})) for item in elements)
    cache_usable = sum(meaningful_name(item.get("tags", {})) is not None for item in elements)
    technical = [
        {"id": f"osm_{item['type']}_{item['id']}", "name_tags": _name_tags(item.get("tags", {}))}
        for item in elements
        if _has_name_tag(item.get("tags", {})) and meaningful_name(item.get("tags", {})) is None
    ]

    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    name_index, id_index = snapshot["fields"].index("name"), snapshot["fields"].index("id")
    snapshot_excluded = [
        {"id": row[id_index], "stored_name": row[name_index]}
        for row in snapshot["places"]
        if safe_display_name(row[name_index]) is None
    ]
    return {
        "audited_at": datetime.now(UTC).isoformat(),
        "policy": {
            "choice": "skip_without_meaningful_name",
            "name_sources": list(NAME_KEYS),
            "technical_name_rule": (
                "Whole-name numeric/punctuation, explicit OSM/ref/id, "
                "or short letter prefix with multiple numeric groups."
            ),
            "brand_policy": (
                "Keep names with words/digits and ambiguous short brands such as Z-1 and А8."
            ),
            "raw_source_policy": (
                "Preserve original cache tags; use a SQLite backup before cleanup."
            ),
        },
        "database": {
            "path": str(database_path),
            "total": len(rows),
            "missing_name_tag_count": missing,
            "stored_name_not_in_name_tags_count": mismatches,
            "excluded_count": excluded,
            "excluded_percent": _percent(excluded, len(rows)),
            "renamed_count": renamed,
            "usable_count": len(rows) - excluded,
            "affected_places": affected,
        },
        "cache": {
            "path": str(cache_path),
            "total": len(elements),
            "missing_name_tag_count": cache_missing,
            "missing_name_tag_percent": _percent(cache_missing, len(elements)),
            "technical_name_count": len(technical),
            "usable_name_count": cache_usable,
            "technical_places": technical,
        },
        "snapshot": {
            "path": str(snapshot_path),
            "total": len(snapshot["places"]),
            "excluded_count": len(snapshot_excluded),
            "excluded_percent": _percent(len(snapshot_excluded), len(snapshot["places"])),
            "usable_count": len(snapshot["places"]) - len(snapshot_excluded),
            "affected_places": snapshot_excluded,
        },
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=ROOT / "backend/data/poi.sqlite3")
    parser.add_argument("--cache", type=Path, default=ROOT / "backend/cache/overpass.json")
    parser.add_argument("--snapshot", type=Path, default=ROOT / "data/poi-astana.json")
    parser.add_argument("--output", type=Path, help="Save the report; inputs remain unchanged.")
    args = parser.parse_args(argv)
    report = build_report(args.database, args.cache, args.snapshot)
    serialized = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output is None:
        print(serialized, end="")
    else:
        args.output.write_text(serialized, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
