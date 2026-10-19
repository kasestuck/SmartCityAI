"""Transit collection keeps stop facts separate and reuses bounded POI infrastructure."""

import json
import sqlite3
from dataclasses import replace
from datetime import datetime, timedelta

import pytest

from backend.config import BACKEND_DIR, Settings
from backend.database.db import Database

STAMP = "2026-10-19T09:00:00+00:00"


def element(identity=1, kind="node", **tags):
    result = {"type": kind, "id": identity, "tags": tags}
    result.update(
        {"lat": 51.1, "lon": 71.4} if kind == "node" else {"center": {"lat": 51.1, "lon": 71.4}}
    )
    return result


def settings_for(tmp_path):
    return Settings(
        _env_file=None,
        database_path=tmp_path / "poi.sqlite3",
        poi_cache_path=tmp_path / "poi-cache.json",
        transit_cache_path=tmp_path / "transit-cache.json",
        overpass_url="https://overpass.example/api/interpreter",
        overpass_retry_delay_seconds=0,
    )


def stored(database):
    with database.connection(readonly=True) as connection:
        return connection.execute("SELECT * FROM transit_stops ORDER BY id").fetchall()


def test_initialize_adds_separate_transit_table_without_touching_existing_poi(tmp_path):
    database = Database(tmp_path / "poi.sqlite3")
    database.initialize()
    with database.connection() as connection:
        connection.execute(
            """INSERT INTO poi (id,osm_type,osm_id,name,latitude,longitude,category,
            source,collected_at,tags_json) VALUES
            ('poi-1','node',1,'Existing cafe',51.1,71.4,'cafe','OpenStreetMap',?,'{}')""",
            (STAMP,),
        )
        before = connection.execute("SELECT * FROM poi").fetchall()
    database.initialize()
    with database.connection(readonly=True) as connection:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master")}
        assert "transit_stops" in tables
        assert connection.execute("SELECT * FROM poi").fetchall() == before


def test_transit_cache_path_uses_backend_anchor_and_separate_default():
    settings = Settings(_env_file=None, transit_cache_path="cache/transit-test.json")
    assert settings.transit_cache_path == (BACKEND_DIR / "cache/transit-test.json").resolve()
    default = Settings(_env_file=None)
    assert default.transit_cache_path != default.poi_cache_path


@pytest.mark.parametrize(
    "tags,expected",
    [
        ({"highway": "bus_stop"}, "bus"),
        ({"public_transport": "stop_position", "bus": "yes"}, "bus"),
        ({"public_transport": "platform", "bus": "yes"}, "bus"),
        ({"public_transport": "stop", "bus": "yes"}, "bus"),
        ({"railway": "stop", "public_transport": "stop_position", "light_rail": "yes"}, "lrt"),
        ({"railway": "station", "public_transport": "station", "station": "light_rail"}, "lrt"),
        ({"railway": "platform", "light_rail": "yes"}, "lrt"),
        ({"railway": "tram_stop"}, "tram"),
        ({"public_transport": "platform", "tram": "yes"}, "tram"),
    ],
)
def test_observed_and_supported_stop_tags_are_classified(tags, expected):
    from backend.services.transit_collector import normalize_element

    stop = normalize_element(element(**tags, name="Бәйтерек"), STAMP)
    assert stop.stop_type == expected
    assert stop.name == "Бәйтерек"
    assert stop.collected_at == STAMP


@pytest.mark.parametrize("kind", ["node", "way", "relation"])
def test_stop_geometry_uses_center_for_non_nodes_and_preserves_route_ref(kind):
    from backend.services.transit_collector import normalize_element

    stop = normalize_element(
        element(12, kind, highway="bus_stop", name="Остановка", route_ref=" 10;12A ", ref="23"),
        STAMP,
    )
    assert (stop.id, stop.latitude, stop.longitude) == (f"osm_{kind}_12", 51.1, 71.4)
    assert stop.route_refs == "10;12A"


@pytest.mark.parametrize("tags", [{}, {"name": "Т34-85"}, {"ref": "42"}, {"name": " "}])
def test_stop_without_human_name_keeps_coordinates_without_exposing_code(tags):
    from backend.services.transit_collector import normalize_element

    stop = normalize_element(element(highway="bus_stop", **tags), STAMP)
    assert stop.name is None
    assert stop.route_refs is None


def test_localized_name_is_used_and_station_ref_is_not_a_route_number():
    from backend.services.transit_collector import normalize_element

    stop = normalize_element(
        element(railway="station", station="light_rail", ref="14", **{"name:kk": "Бәйтерек"}),
        STAMP,
    )
    assert stop.name == "Бәйтерек"
    assert stop.route_refs is None


@pytest.mark.parametrize(
    "tags",
    [
        {"railway": "light_rail"},
        {"railway": "station"},
        {"railway": "stop", "train": "yes"},
        {"public_transport": "station"},
        {"public_transport": "platform"},
        {"amenity": "cafe"},
        {"highway": "bus_stop", "construction": "yes"},
        {"highway": "bus_stop", "proposed": "yes"},
        {"highway": "bus_stop", "disused": "yes"},
        {"highway": "bus_stop", "abandoned": "yes"},
        {"railway": "construction", "station": "light_rail"},
        {"railway": "proposed", "light_rail": "yes", "public_transport": "station"},
        {"public_transport": "platform", "light_rail": "yes", "construction:railway": "platform"},
        {"highway": "bus_stop", "disused:highway": "bus_stop"},
    ],
)
def test_tracks_heavy_rail_unclassified_and_inactive_objects_are_not_stops(tags):
    from backend.services.transit_collector import normalize_element

    assert normalize_element(element(**tags), STAMP) is None


def test_explicit_false_lifecycle_marker_does_not_hide_active_stop():
    from backend.services.transit_collector import normalize_element

    assert normalize_element(element(highway="bus_stop", construction="no"), STAMP) is not None


@pytest.mark.parametrize(
    "change",
    [
        {"lat": 91},
        {"lon": float("nan")},
        {"lat": True},
        {"lat": "51.1"},
        {"id": -1},
        {"type": "way"},
        {"type": "relation", "center": {}},
        {"tags": []},
    ],
)
def test_invalid_stop_identity_geometry_or_tags_are_skipped(change):
    from backend.services.transit_collector import normalize_element

    assert normalize_element({**element(highway="bus_stop"), **change}, STAMP) is None


def test_transit_upsert_updates_and_rolls_back_without_duplicates(tmp_path):
    from backend.database.models import TransitStop

    database = Database(tmp_path / "poi.sqlite3")
    database.initialize()
    stop = TransitStop("osm_node_1", "Stop", 51.1, 71.4, "bus", "12", STAMP)
    assert database.upsert_transit_stops([stop]) == 1
    assert database.upsert_transit_stops([replace(stop, name=None, route_refs=None)]) == 1
    assert len(stored(database)) == 1
    assert stored(database)[0][1] is None
    with pytest.raises(sqlite3.IntegrityError):
        database.upsert_transit_stops(
            [replace(stop, name="Rollback"), replace(stop, id="osm_node_2", latitude=100)]
        )
    assert stored(database)[0][1] is None


def test_collect_uses_separate_cache_original_date_and_deduplicates(tmp_path, monkeypatch):
    from backend.services import transit_collector as collector

    settings = settings_for(tmp_path)
    settings.poi_cache_path.write_text("POI cache must remain intact", encoding="utf-8")
    database = Database(settings.database_path)
    database.initialize()
    raw = {
        "elements": [
            element(highway="bus_stop"),
            element(highway="bus_stop"),
            element(2, railway="station", station="light_rail"),
            element(3, railway="light_rail"),
        ]
    }
    monkeypatch.setattr(collector, "download_overpass", lambda *_: raw)
    monkeypatch.setattr(collector, "utc_now", lambda: datetime.fromisoformat(STAMP))
    first = collector.collect_transit(settings, database)
    assert (first.received, first.saved, first.skipped, first.from_cache) == (4, 2, 2, False)
    monkeypatch.setattr(
        collector, "download_overpass", lambda *_: pytest.fail("cache hit expected")
    )
    monkeypatch.setattr(
        collector, "utc_now", lambda: datetime.fromisoformat(STAMP) + timedelta(hours=1)
    )
    second = collector.collect_transit(settings, database)
    assert second.from_cache and second.collected_at == STAMP
    assert len(stored(database)) == 2
    assert settings.poi_cache_path.read_text(encoding="utf-8") == "POI cache must remain intact"


@pytest.mark.parametrize(
    "bad",
    [
        {"remark": "timeout", "elements": []},
        {"elements": "invalid"},
        {"elements": [{"type": "node", "id": 1, "tags": []}]},
    ],
)
def test_bad_response_preserves_successful_stop_rows_and_cache(tmp_path, monkeypatch, bad):
    from backend.services import transit_collector as collector
    from backend.services.poi_collector import CollectionError

    settings = settings_for(tmp_path)
    database = Database(settings.database_path)
    database.initialize()
    monkeypatch.setattr(
        collector, "download_overpass", lambda *_: {"elements": [element(highway="bus_stop")]}
    )
    collector.collect_transit(settings, database)
    before = settings.transit_cache_path.read_bytes()
    monkeypatch.setattr(collector, "download_overpass", lambda *_: bad)
    with pytest.raises(CollectionError):
        collector.collect_transit(settings, database, force=True)
    assert settings.transit_cache_path.read_bytes() == before
    assert len(stored(database)) == 1


def test_empty_response_and_network_failure_preserve_existing_rows(tmp_path, monkeypatch):
    from backend.services import transit_collector as collector
    from backend.services.poi_collector import CollectionError

    settings = settings_for(tmp_path)
    database = Database(settings.database_path)
    database.initialize()
    monkeypatch.setattr(
        collector, "download_overpass", lambda *_: {"elements": [element(highway="bus_stop")]}
    )
    collector.collect_transit(settings, database)
    monkeypatch.setattr(collector, "download_overpass", lambda *_: {"elements": []})
    assert collector.collect_transit(settings, database, force=True).saved == 0
    assert len(stored(database)) == 1

    def fail(*args):
        raise CollectionError("Overpass unavailable")

    monkeypatch.setattr(collector, "download_overpass", fail)
    with pytest.raises(CollectionError):
        collector.collect_transit(settings, database, force=True)
    assert len(stored(database)) == 1


def test_query_covers_actual_astana_tag_forms_and_uses_configured_bbox():
    from backend.services.transit_collector import build_query

    settings = Settings(_env_file=None)
    query = build_query(settings)
    assert query == (
        "[out:json][timeout:45];("
        'nwr["public_transport"~"^(stop|stop_position|platform|station)$"](50.95,71.2,51.3,71.75);'
        'nwr["highway"="bus_stop"](50.95,71.2,51.3,71.75);'
        'nwr["railway"~"^(tram_stop|station|halt|platform|light_rail)$"](50.95,71.2,51.3,71.75);'
        'nwr["station"="light_rail"](50.95,71.2,51.3,71.75);'
        'nwr["construction"="station"](50.95,71.2,51.3,71.75););out center;'
    )


def test_cli_collects_and_reports_counts(tmp_path, monkeypatch, capsys):
    from backend.scripts import collect_transit as cli
    from backend.services import transit_collector as collector

    settings = settings_for(tmp_path)
    monkeypatch.setattr(cli, "Settings", lambda: settings)
    monkeypatch.setattr(
        collector, "download_overpass", lambda *_: {"elements": [element(highway="bus_stop")]}
    )
    assert cli.main(["--force"]) == 0
    assert len(stored(Database(settings.database_path))) == 1
    output = capsys.readouterr().out
    assert "received=1 saved=1 skipped=0" in output and "network" in output
    cached = json.loads(settings.transit_cache_path.read_text(encoding="utf-8"))
    assert cached["payload"]["elements"][0]["tags"]["highway"] == "bus_stop"
