"""Name provenance and code filtering use local data only."""

import json

import pytest

from backend.services.poi_collector import normalize_element

STAMP = "2026-10-18T00:00:00+00:00"


@pytest.mark.parametrize("name", ["Т34-85", "T34-85", "T-34-85", "T34–85"])
def test_collector_skips_technical_code_names(name):
    raw = {
        "type": "node",
        "id": 1,
        "lat": 51.1,
        "lon": 71.4,
        "tags": {"name": name, "tourism": "attraction", "historic": "tank"},
    }
    assert normalize_element(raw, STAMP, "OpenStreetMap") is None


@pytest.mark.parametrize("key", ["name:ru", "name:kk", "name:en"])
def test_collector_uses_meaningful_localized_name_after_a_code(key):
    raw = {
        "type": "node",
        "id": 1,
        "lat": 51.1,
        "lon": 71.4,
        "tags": {"name": "T34-85", key: "Памятник Победы", "tourism": "attraction"},
    }
    poi = normalize_element(raw, STAMP, "OpenStreetMap")
    assert poi.name == "Памятник Победы"
    assert json.loads(poi.tags_json) == raw["tags"]


@pytest.mark.parametrize("key", ["ref", "id", "local_ref", "official_name"])
def test_collector_does_not_invent_a_name_from_other_tags(key):
    raw = {
        "type": "node",
        "id": 123,
        "lat": 51.1,
        "lon": 71.4,
        "tags": {key: "Some reference", "tourism": "attraction"},
    }
    assert normalize_element(raw, STAMP, "OpenStreetMap") is None


@pytest.mark.parametrize(
    "name",
    [
        "Qazaq24",
        "Platforma8",
        "Fest425",
        "Aizere2",
        "Z-1",
        "А8",
        "SF",
        "ÖM",
        "33 Тағам",
        "Студия 1337",
        "Тәуелсіздіктің 25 жылдығы",
        "Trattoria HighVill D-7",
    ],
)
def test_name_policy_keeps_real_names_and_brands_with_digits(name):
    from backend.services.poi_names import meaningful_name, safe_display_name

    assert meaningful_name({"name": name}) == name
    assert safe_display_name(name, "{}") == name


@pytest.mark.parametrize(
    "name",
    [
        "123456",
        "№ 1234",
        "---",
        "osm_node_4209560711",
        "node/4209560711",
        "way 1234",
        "relation:5678",
        "ref:1234",
        "ID=1234",
        "T34-85",
        "Т34-85",
    ],
)
def test_name_policy_suppresses_technical_identifiers(name):
    from backend.services.poi_names import meaningful_name, safe_display_name

    assert meaningful_name({"name": name}) is None
    assert safe_display_name(name, "{}") is None


@pytest.mark.parametrize("tags", [None, {}, {"ref": "Cafe reference"}, {"name": None}])
def test_meaningful_name_requires_an_actual_name_tag(tags):
    from backend.services.poi_names import meaningful_name

    assert meaningful_name(tags) is None


def test_name_source_priority_and_trim_are_consistent():
    from backend.services.poi_names import meaningful_name

    assert meaningful_name({"name": " Central Park ", "name:ru": "Парк"}) == "Central Park"
    assert (
        meaningful_name({"name": "T34-85", "name:ru": " Памятник ", "name:kk": "Атауы"})
        == "Памятник"
    )
    assert (
        meaningful_name({"name": "", "name:ru": "", "name:kk": " Атауы ", "name:en": "Name"})
        == "Атауы"
    )
    assert meaningful_name({"name": 123, "name:ru": False, "name:en": " Name "}) == "Name"


def test_legacy_name_uses_name_tag_provenance_and_localized_repair():
    from backend.services.poi_names import safe_display_name

    tags = {"name": "T34-85", "name:ru": "Памятник Победы", "ref": "T34-85"}
    assert safe_display_name("T34-85", json.dumps(tags)) == "Памятник Победы"
    assert safe_display_name("Wrong stored name", {"name": "Central Park"}) == "Central Park"
    assert safe_display_name("Cafe reference", {"ref": "Cafe reference"}) is None


@pytest.mark.parametrize("tags_json", [None, "{}", "not json", "[]", "null"])
def test_legacy_human_names_stay_usable_without_tag_provenance(tags_json):
    from backend.services.poi_names import safe_display_name

    assert safe_display_name(" Central Park ", tags_json) == "Central Park"
    assert safe_display_name("T34-85", tags_json) is None


def test_repeatable_audit_reports_provenance_without_changing_sources(tmp_path):
    import sqlite3

    from backend.scripts.audit_poi_names import build_report

    db = tmp_path / "poi.sqlite3"
    with sqlite3.connect(db) as connection:
        connection.execute("CREATE TABLE poi (id, name, tags_json)")
        connection.executemany(
            "INSERT INTO poi VALUES (?, ?, ?)",
            [
                ("osm_node_1", "Central Park", '{"name":"Central Park"}'),
                ("osm_node_2", "T34-85", '{"name":"T34-85"}'),
                ("osm_node_3", "RoadRef", '{"ref":"RoadRef"}'),
                ("osm_node_4", "T34-85", '{"name":"T34-85","name:en":"Memorial"}'),
                ("osm_node_5", "Legacy cafe", "{}"),
            ],
        )
    cache = tmp_path / "overpass.json"
    cache.write_text(
        json.dumps(
            {
                "payload": {
                    "elements": [
                        {"type": "node", "id": 1, "tags": {"name": "Central Park"}},
                        {"type": "node", "id": 2, "tags": {"name": "T34-85"}},
                        {"type": "node", "id": 3, "tags": {"ref": "RoadRef"}},
                        {
                            "type": "node",
                            "id": 4,
                            "tags": {"name": "T34-85", "name:en": "Memorial"},
                        },
                    ]
                }
            }
        ),
        encoding="utf-8",
    )
    snapshot = tmp_path / "snapshot.json"
    snapshot.write_text(
        json.dumps(
            {
                "fields": ["id", "name"],
                "places": [
                    ["osm_node_1", "Central Park"],
                    ["osm_node_2", "T34-85"],
                    ["osm_node_3", "osm_node_3"],
                ],
            }
        ),
        encoding="utf-8",
    )
    before = {path: path.read_bytes() for path in (db, cache, snapshot)}

    report = build_report(db, cache, snapshot)

    assert report["database"]["total"] == 5
    assert report["database"]["excluded_count"] == 2
    assert report["database"]["excluded_percent"] == 40.0
    assert report["database"]["renamed_count"] == 1
    assert {row["id"] for row in report["database"]["affected_places"]} == {
        "osm_node_2",
        "osm_node_3",
        "osm_node_4",
    }
    assert report["cache"]["total"] == 4
    assert report["cache"]["missing_name_tag_count"] == 1
    assert report["cache"]["technical_name_count"] == 1
    assert report["cache"]["usable_name_count"] == 2
    assert report["snapshot"]["total"] == 3
    assert report["snapshot"]["excluded_count"] == 2
    assert {path: path.read_bytes() for path in before} == before


def test_snapshot_builder_filters_codes_uses_localized_names_and_keeps_brands(
    tmp_path, monkeypatch
):
    from tools import build_poi_snapshot as builder

    tags = [
        {"name": "Т34-85", "tourism": "attraction"},
        {"name": "T34-85", "name:ru": "Памятник Победы", "tourism": "attraction"},
        {"name": "Qazaq24", "amenity": "cafe"},
        {"ref": "Reference only", "tourism": "attraction"},
    ]
    payload = {
        "elements": [
            {"type": "node", "id": index, "lat": 51.1, "lon": 71.4, "tags": item}
            for index, item in enumerate(tags, start=1)
        ]
    }
    destination = tmp_path / "snapshot.json"
    monkeypatch.setattr(builder, "download", lambda: payload)
    monkeypatch.setattr(builder, "OUT", destination)

    assert builder.main() == 0

    result = json.loads(destination.read_text(encoding="utf-8"))
    assert [(row[0], row[1]) for row in result["places"]] == [
        ("osm_node_2", "Памятник Победы"),
        ("osm_node_3", "Qazaq24"),
    ]
    assert result["source"] == "OpenStreetMap"


def test_snapshot_script_runs_shared_name_policy_without_cwd_imports(tmp_path):
    import subprocess
    import sys
    from pathlib import Path

    script = Path(__file__).resolve().parents[2] / "tools/build_poi_snapshot.py"
    # -I removes cwd/PYTHONPATH imports, reproducing direct script startup.
    # Inject local input/output before main runs: no HTTP or real snapshot writes.
    code = (
        "import json, pathlib, runpy, sys; "
        "module = runpy.run_path(sys.argv[1], run_name='snapshot_import'); "
        "main = module['main']; "
        "main.__globals__['download'] = lambda: {'elements': ["
        "{'type': 'node', 'id': 1, 'lat': 51.1, 'lon': 71.4, "
        "'tags': {'name': 'T34-85', 'tourism': 'attraction'}}]}; "
        "main.__globals__['OUT'] = pathlib.Path(sys.argv[2]); "
        "assert main() == 0; "
        "assert json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))['places'] == []"
    )
    result = subprocess.run(
        [sys.executable, "-I", "-c", code, str(script), str(tmp_path / "snapshot.json")],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
