"""Collector tests use temporary databases and deterministic HTTP replacements."""

import io
import json
import sqlite3
import subprocess
import sys
from dataclasses import replace
from datetime import datetime, timedelta
from http.client import IncompleteRead
from urllib.error import HTTPError, URLError

import pytest

from backend.config import Settings
from backend.database.db import Database
from backend.database.models import POI

STAMP = "2026-10-17T10:00:00+00:00"


def element(osm_id=1, osm_type="node", **tags):
    result = {
        "type": osm_type,
        "id": osm_id,
        "tags": {"name": "Test place", "amenity": "cafe", **tags},
    }
    result.update(
        {"lat": 51.1, "lon": 71.4} if osm_type == "node" else {"center": {"lat": 51.1, "lon": 71.4}}
    )
    return result


def payload(elements=None, **extra):
    return {"elements": [element()] if elements is None else elements, **extra}


def settings_for(tmp_path, **extra):
    return Settings(
        _env_file=None,
        database_path=tmp_path / "poi.sqlite3",
        poi_cache_path=tmp_path / "cache.json",
        overpass_url="https://overpass.example/api/interpreter",
        overpass_bbox=(50.95, 71.20, 51.30, 71.75),
        overpass_timeout_seconds=3,
        overpass_attempts=3,
        overpass_retry_delay_seconds=0,
        poi_cache_ttl_seconds=86400,
        **extra,
    )


def stored(database):
    with database.connection(readonly=True) as connection:
        connection.row_factory = sqlite3.Row
        return [dict(row) for row in connection.execute("SELECT * FROM poi ORDER BY id")]


def sample_poi():
    return POI(
        "osm_node_1",
        "node",
        1,
        "Initial",
        51.1,
        71.4,
        "cafe",
        None,
        None,
        "OpenStreetMap",
        STAMP,
        "{}",
    )


def test_upsert_updates_osm_identity_and_is_transactional(tmp_path):
    database = Database(tmp_path / "poi.sqlite3")
    database.initialize()
    assert database.upsert_pois([sample_poi()]) == 1
    assert database.upsert_pois([replace(sample_poi(), name="Updated")]) == 1
    assert len(stored(database)) == 1
    assert stored(database)[0]["name"] == "Updated"
    with pytest.raises(sqlite3.IntegrityError):
        database.upsert_pois(
            [
                replace(sample_poi(), name="Rolled back"),
                replace(sample_poi(), id="osm_node_2", osm_id=2, latitude=100),
            ]
        )
    assert stored(database)[0]["name"] == "Updated"


@pytest.mark.parametrize("osm_type", ["node", "way", "relation"])
def test_normalizes_geometry_and_preserves_only_available_facts(osm_type):
    from backend.services.poi_collector import normalize_element

    raw = element(
        12,
        osm_type,
        **{
            "name:ru": "Русское имя",
            "description": "Real description",
            "opening_hours": "Mo-Fr 10:00-18:00",
        },
    )
    poi = normalize_element(raw, STAMP, "OpenStreetMap")
    assert poi.id == f"osm_{osm_type}_12"
    assert (poi.latitude, poi.longitude, poi.category) == (51.1, 71.4, "cafe")
    assert poi.description == "Real description"
    assert poi.opening_hours == "Mo-Fr 10:00-18:00"
    assert json.loads(poi.tags_json) == raw["tags"]
    bare = normalize_element(element(), STAMP, "OpenStreetMap")
    assert bare.description is None and bare.opening_hours is None


@pytest.mark.parametrize(
    "key,value,category",
    [
        ("amenity", "cafe", "cafe"),
        ("amenity", "restaurant", "restaurant"),
        ("leisure", "park", "park"),
        ("tourism", "museum", "museum"),
        ("tourism", "attraction", "attraction"),
        ("tourism", "viewpoint", "viewpoint"),
        ("leisure", "playground", "playground"),
    ],
)
def test_categories_and_localized_name_fallback(key, value, category):
    from backend.services.poi_collector import normalize_element

    raw = element()
    raw["tags"] = {key: value, "name": " ", "name:ru": "", "name:kk": "Атауы", "name:en": "Name"}
    assert normalize_element(raw, STAMP, "OpenStreetMap").category == category
    assert normalize_element(raw, STAMP, "OpenStreetMap").name == "Атауы"


@pytest.mark.parametrize(
    "change",
    [
        {"lat": 91},
        {"lon": float("nan")},
        {"lat": True},
        {"lat": "51.1"},
        {"tags": {}},
        {"type": "way"},
        {"type": "relation", "center": {}},
        {"id": -1},
        {"tags": {"name": "Place", "amenity": "bank"}},
    ],
)
def test_unusable_poi_are_skipped(change):
    from backend.services.poi_collector import normalize_element

    assert normalize_element({**element(), **change}, STAMP, "OpenStreetMap") is None


def test_category_priority_is_fixed():
    from backend.services.poi_collector import normalize_element

    assert (
        normalize_element(element(tourism="museum", leisure="park"), STAMP, "OSM").category
        == "cafe"
    )


def test_collect_counts_deduplicates_preserves_source_date_and_uses_cache(tmp_path, monkeypatch):
    from backend.services import poi_collector as collector

    settings = settings_for(tmp_path)
    database = Database(settings.database_path)
    database.initialize()
    original = payload(
        [element(), element(), element(2, "way"), element(3, "relation"), element(4, name="")],
        osm3s={"timestamp_osm_base": "2026-10-16T09:00:00Z"},
    )
    monkeypatch.setattr(collector, "download_overpass", lambda *_: original)
    monkeypatch.setattr(collector, "utc_now", lambda: datetime.fromisoformat(STAMP))
    first = collector.collect_poi(settings, database)
    assert (first.received, first.saved, first.skipped, first.from_cache) == (5, 3, 2, False)
    assert first.collected_at == STAMP
    assert stored(database)[0]["source"] == "OpenStreetMap"
    assert (
        json.loads(settings.poi_cache_path.read_text(encoding="utf-8"))["payload"]["osm3s"][
            "timestamp_osm_base"
        ]
        == "2026-10-16T09:00:00Z"
    )
    monkeypatch.setattr(
        collector, "download_overpass", lambda *_: pytest.fail("fresh cache must avoid HTTP")
    )
    monkeypatch.setattr(
        collector, "utc_now", lambda: datetime.fromisoformat(STAMP) + timedelta(hours=1)
    )
    second = collector.collect_poi(settings, database)
    assert second.from_cache and second.collected_at == first.collected_at
    assert len(stored(database)) == 3


@pytest.mark.parametrize("damage", ["expired", "broken", "wrong_query", "wrong_endpoint", "future"])
def test_unusable_cache_requires_network_and_does_not_damage_database(
    tmp_path, monkeypatch, damage
):
    from backend.services import poi_collector as collector

    settings = settings_for(tmp_path)
    database = Database(settings.database_path)
    database.initialize()
    monkeypatch.setattr(collector, "download_overpass", lambda *_: payload())
    monkeypatch.setattr(collector, "utc_now", lambda: datetime.fromisoformat(STAMP))
    collector.collect_poi(settings, database)
    if damage == "broken":
        settings.poi_cache_path.write_text("not-json", encoding="utf-8")
    elif damage == "wrong_query":
        settings = settings.model_copy(update={"overpass_bbox": (51.0, 71.0, 51.2, 71.6)})
    elif damage == "wrong_endpoint":
        settings = settings.model_copy(update={"overpass_url": "https://other.example/interpreter"})
    else:
        offset = timedelta(days=2) if damage == "expired" else timedelta(days=-1)
        monkeypatch.setattr(collector, "utc_now", lambda: datetime.fromisoformat(STAMP) + offset)
    monkeypatch.setattr(
        collector,
        "download_overpass",
        lambda *_: (_ for _ in ()).throw(collector.CollectionError("Overpass unavailable")),
    )
    with pytest.raises(collector.CollectionError):
        collector.collect_poi(settings, database)
    assert len(stored(database)) == 1


@pytest.mark.parametrize(
    "bad_payload",
    [
        {"remark": "runtime error: timed out", "elements": []},
        {},
        {"elements": "invalid"},
        {"elements": ["invalid"]},
        {"elements": [{"type": "node", "id": 1, "tags": []}]},
    ],
)
def test_force_bad_response_preserves_successful_cache_and_database(
    tmp_path, monkeypatch, bad_payload
):
    from backend.services import poi_collector as collector

    settings = settings_for(tmp_path)
    database = Database(settings.database_path)
    database.initialize()
    monkeypatch.setattr(collector, "download_overpass", lambda *_: payload())
    collector.collect_poi(settings, database)
    before = settings.poi_cache_path.read_bytes()
    monkeypatch.setattr(collector, "download_overpass", lambda *_: bad_payload)
    with pytest.raises(collector.CollectionError):
        collector.collect_poi(settings, database, force=True)
    assert settings.poi_cache_path.read_bytes() == before
    assert len(stored(database)) == 1


def test_force_fetches_again(tmp_path, monkeypatch):
    from backend.services import poi_collector as collector

    settings = settings_for(tmp_path)
    database = Database(settings.database_path)
    database.initialize()
    monkeypatch.setattr(collector, "download_overpass", lambda *_: payload())
    collector.collect_poi(settings, database)
    monkeypatch.setattr(collector, "download_overpass", lambda *_: payload([element(2)]))
    assert not collector.collect_poi(settings, database, force=True).from_cache
    assert len(stored(database)) == 2


def test_http_post_uses_bbox_centers_timeout_and_retry_after(tmp_path):
    from backend.services.poi_collector import build_query, download_overpass

    settings = settings_for(tmp_path)
    calls = []
    delays = []

    def opener(request, timeout):
        calls.append((request, timeout))
        if len(calls) == 1:
            raise HTTPError(request.full_url, 429, "secret metadata", {"Retry-After": "2"}, None)
        if len(calls) == 2:
            raise URLError("secret network address")
        return io.BytesIO(json.dumps(payload()).encode())

    query = build_query(settings)
    result = download_overpass(settings, query, opener=opener, sleeper=delays.append)
    assert result == payload()
    assert len(calls) == 3 and delays == [2.0, 0.0]
    assert all(timeout == 3 for _, timeout in calls)
    assert calls[0][0].method == "POST"
    assert "nwr" in query and "out center" in query
    assert "50.95,71.2,51.3,71.75" in query


@pytest.mark.parametrize(
    "failure",
    [
        TimeoutError("secret"),
        HTTPError("https://secret", 503, "secret", {}, None),
        HTTPError("https://secret", 400, "secret", {}, None),
    ],
)
def test_http_failures_are_bounded_and_sanitized(tmp_path, failure):
    from backend.services.poi_collector import CollectionError, download_overpass

    calls = []

    def opener(*args, **kwargs):
        calls.append(1)
        raise failure

    with pytest.raises(CollectionError) as error:
        download_overpass(settings_for(tmp_path), "query", opener=opener, sleeper=lambda _: None)
    assert len(calls) == (1 if isinstance(failure, HTTPError) and failure.code == 400 else 3)
    assert "secret" not in str(error.value)


def test_cli_initializes_database_and_reports_safe_failure(tmp_path, monkeypatch, capsys):
    from backend.scripts import collect_poi as cli
    from backend.services.poi_collector import CollectionError

    settings = settings_for(tmp_path)
    monkeypatch.setattr(cli, "Settings", lambda: settings)
    monkeypatch.setattr(
        cli,
        "collect_poi",
        lambda *args, **kwargs: (_ for _ in ()).throw(CollectionError("Overpass unavailable")),
    )
    assert cli.main([]) == 1
    assert settings.database_path.exists()
    assert "Overpass unavailable" in capsys.readouterr().err


@pytest.mark.parametrize(
    "arguments",
    [["-m", "backend.scripts.collect_poi", "--help"], ["backend/scripts/collect_poi.py", "--help"]],
)
def test_cli_help_supports_both_entrypoints(arguments):
    result = subprocess.run(
        [sys.executable, *arguments], capture_output=True, text=True, check=False
    )
    assert result.returncode == 0, result.stderr
    assert "--force" in result.stdout


def test_malformed_endpoint_has_safe_failure(tmp_path):
    from backend.services.poi_collector import CollectionError, download_overpass

    settings = settings_for(tmp_path).model_copy(update={"overpass_url": "secret invalid endpoint"})
    with pytest.raises(CollectionError, match="configuration"):
        download_overpass(settings, "query", sleeper=lambda _: None)


@pytest.mark.parametrize(
    "retry_after,expected", [("Sat, 17 Oct 2026 10:00:03 GMT", 3), ("nonsense", 0)]
)
def test_retry_after_date_and_malformed_header(tmp_path, monkeypatch, retry_after, expected):
    from backend.services import poi_collector as collector

    monkeypatch.setattr(collector, "utc_now", lambda: datetime.fromisoformat(STAMP))
    calls = []
    delays = []

    def opener(request, timeout):
        calls.append(1)
        if len(calls) == 1:
            raise HTTPError(request.full_url, 503, "private", {"Retry-After": retry_after}, None)
        return io.BytesIO(json.dumps(payload()).encode())

    collector.download_overpass(
        settings_for(tmp_path), "query", opener=opener, sleeper=delays.append
    )
    assert delays == [expected]


def test_retry_after_beyond_bound_fails_instead_of_retrying_early(tmp_path):
    from backend.services import poi_collector as collector

    def opener(request, timeout):
        raise HTTPError(request.full_url, 429, "private", {"Retry-After": "3600"}, None)

    with pytest.raises(collector.CollectionError, match="later"):
        collector.download_overpass(
            settings_for(tmp_path),
            "query",
            opener=opener,
            sleeper=lambda _: pytest.fail("must not retry early"),
        )


def test_invalid_json_fails_without_retry(tmp_path):
    from backend.services import poi_collector as collector

    with pytest.raises(collector.CollectionError, match="JSON"):
        collector.download_overpass(
            settings_for(tmp_path),
            "query",
            opener=lambda *args, **kwargs: io.BytesIO(b"secret invalid JSON"),
            sleeper=lambda _: pytest.fail("invalid JSON is not retryable"),
        )


def test_atomic_cache_replace_failure_retains_previous_cache(tmp_path, monkeypatch):
    from backend.services import poi_collector as collector

    settings = settings_for(tmp_path)
    database = Database(settings.database_path)
    database.initialize()
    monkeypatch.setattr(collector, "download_overpass", lambda *_: payload())
    collector.collect_poi(settings, database)
    before = settings.poi_cache_path.read_bytes()
    monkeypatch.setattr(
        collector.os, "replace", lambda *_: (_ for _ in ()).throw(OSError("private"))
    )
    with pytest.raises(collector.CollectionError, match="cache"):
        collector.collect_poi(settings, database, force=True)
    assert settings.poi_cache_path.read_bytes() == before
    assert not list(tmp_path.glob("*.tmp"))


def test_cli_success_outputs_counts_and_origin(tmp_path, monkeypatch, capsys):
    from backend.scripts import collect_poi as cli
    from backend.services import poi_collector as collector

    settings = settings_for(tmp_path)
    monkeypatch.setattr(cli, "Settings", lambda: settings)
    monkeypatch.setattr(collector, "download_overpass", lambda *_: payload())
    assert cli.main(["--force"]) == 0
    output = capsys.readouterr().out
    assert "network" in output and "received=1 saved=1 skipped=0" in output
    assert "OpenStreetMap" in output and "collected_at=" in output


def test_interrupted_response_read_retries_and_succeeds(tmp_path):
    from backend.services.poi_collector import download_overpass

    class InterruptedResponse(io.BytesIO):
        def read(self, size=-1):
            raise IncompleteRead(b"sensitive partial body", 100)

    responses = [InterruptedResponse(), io.BytesIO(json.dumps(payload()).encode())]
    delays = []
    result = download_overpass(
        settings_for(tmp_path),
        "query",
        opener=lambda *args, **kwargs: responses.pop(0),
        sleeper=delays.append,
    )
    assert result == payload()
    assert delays == [0]


def test_interrupted_response_read_exhaustion_is_bounded_and_sanitized(tmp_path):
    from backend.services.poi_collector import CollectionError, download_overpass

    class InterruptedResponse(io.BytesIO):
        def read(self, size=-1):
            raise IncompleteRead(b"sensitive partial body", 100)

    responses = []

    def opener(*args, **kwargs):
        response = InterruptedResponse()
        responses.append(response)
        return response

    with pytest.raises(CollectionError) as error:
        download_overpass(settings_for(tmp_path), "query", opener=opener, sleeper=lambda _: None)
    assert len(responses) == 3
    assert all(response.closed for response in responses)
    assert "sensitive" not in str(error.value)
    assert "partial body" not in str(error.value)
