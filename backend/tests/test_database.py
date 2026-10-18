import sqlite3
from dataclasses import FrozenInstanceError

import pytest

from backend.database.db import Database
from backend.database.models import POI


def insert_poi(connection, **overrides):
    values = {
        "id": "node:1",
        "osm_type": "node",
        "osm_id": 1,
        "name": "Test park",
        "latitude": 51.1,
        "longitude": 71.4,
        "category": "park",
        "description": None,
        "opening_hours": None,
        "source": "OpenStreetMap",
        "collected_at": "2026-10-17T00:00:00Z",
        "tags_json": "{}",
    }
    values.update(overrides)
    connection.execute(
        f"INSERT INTO poi ({', '.join(values)}) VALUES ({', '.join('?' for _ in values)})",
        tuple(values.values()),
    )


def test_initialize_creates_empty_database_and_preserves_existing_data(tmp_path):
    database = Database(tmp_path / "nested" / "poi.sqlite3")
    database.initialize()
    with database.connection() as connection:
        assert connection.execute("SELECT count(*) FROM poi").fetchone()[0] == 0
        insert_poi(connection)
    database.initialize()
    with database.connection(readonly=True) as connection:
        assert connection.execute("SELECT name FROM poi").fetchone()[0] == "Test park"


def test_initialize_adds_enrichment_to_legacy_database_without_losing_rows(tmp_path):
    database = Database(tmp_path / "legacy.sqlite3")
    with database.connection() as connection:
        connection.execute(
            """
            CREATE TABLE poi (
                id TEXT PRIMARY KEY NOT NULL,
                osm_type TEXT NOT NULL,
                osm_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
                longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
                category TEXT NOT NULL,
                description TEXT,
                opening_hours TEXT,
                source TEXT NOT NULL,
                collected_at TEXT NOT NULL,
                tags_json TEXT NOT NULL,
                UNIQUE (osm_type, osm_id)
            )
            """
        )
        insert_poi(connection, tags_json='{"wheelchair":"limited"}')
        before = connection.execute("SELECT * FROM poi").fetchone()

    database.initialize()
    database.initialize()

    with database.connection(readonly=True) as connection:
        row = connection.execute("SELECT * FROM poi").fetchone()
        assert row[:12] == before
        assert connection.execute(
            "SELECT wheelchair, phone, website, wikidata FROM poi"
        ).fetchone() == (None, None, None, None)
        assert connection.execute("SELECT count(*) FROM poi").fetchone()[0] == 1


def test_osm_identity_is_unique_but_type_is_part_of_identity(tmp_path):
    database = Database(tmp_path / "poi.sqlite3")
    database.initialize()
    with database.connection() as connection:
        insert_poi(connection)
        insert_poi(connection, id="way:1", osm_type="way")
    with pytest.raises(sqlite3.IntegrityError), database.connection() as connection:
        insert_poi(connection, id="duplicate")


@pytest.mark.parametrize(
    "coordinate,value",
    [
        ("latitude", -90.1),
        ("latitude", 90.1),
        ("longitude", -180.1),
        ("longitude", 180.1),
        ("latitude", None),
        ("longitude", float("nan")),
        ("latitude", float("inf")),
    ],
)
def test_invalid_coordinates_are_rejected(tmp_path, coordinate, value):
    database = Database(tmp_path / "poi.sqlite3")
    database.initialize()
    with pytest.raises(sqlite3.IntegrityError), database.connection() as connection:
        insert_poi(connection, **{coordinate: value})


@pytest.mark.parametrize("latitude,longitude", [(-90, -180), (90, 180)])
def test_coordinate_boundaries_are_allowed(tmp_path, latitude, longitude):
    database = Database(tmp_path / "poi.sqlite3")
    database.initialize()
    with database.connection() as connection:
        insert_poi(connection, latitude=latitude, longitude=longitude)


def test_transaction_rolls_back_and_connection_closes_on_failure(tmp_path):
    database = Database(tmp_path / "poi.sqlite3")
    database.initialize()
    with pytest.raises(RuntimeError), database.connection() as failed_connection:
        insert_poi(failed_connection)
        raise RuntimeError("abort transaction")
    with pytest.raises(sqlite3.ProgrammingError):
        failed_connection.execute("SELECT 1")
    with database.connection() as connection:
        assert connection.execute("SELECT count(*) FROM poi").fetchone()[0] == 0
    with pytest.raises(sqlite3.ProgrammingError):
        connection.execute("SELECT 1")


def test_connections_are_fresh_and_readonly_prevents_writes(tmp_path):
    database = Database(tmp_path / "poi.sqlite3")
    database.initialize()
    with database.connection() as first, database.connection(readonly=True) as second:
        assert first is not second
        with pytest.raises(sqlite3.OperationalError):
            insert_poi(second)


def test_health_reads_poi_table(tmp_path):
    database = Database(tmp_path / "poi.sqlite3")
    database.initialize()
    database.check_health()
    with database.connection() as connection:
        connection.execute("DROP TABLE poi")
    with pytest.raises(sqlite3.OperationalError):
        database.check_health()


def test_readonly_and_health_do_not_recreate_missing_database(tmp_path):
    path = tmp_path / "poi.sqlite3"
    database = Database(path)
    database.initialize()
    path.unlink()
    with pytest.raises(sqlite3.OperationalError), database.connection(readonly=True):
        pass
    assert not path.exists()
    with pytest.raises(sqlite3.OperationalError):
        database.check_health()
    assert not path.exists()


def test_schema_has_geography_and_category_indexes(tmp_path):
    database = Database(tmp_path / "poi.sqlite3")
    database.initialize()
    with database.connection() as connection:
        indexes = connection.execute("PRAGMA index_list(poi)").fetchall()
        columns = [
            tuple(row[2] for row in connection.execute(f'PRAGMA index_info("{index[1]}")'))
            for index in indexes
        ]
    assert ("latitude", "longitude") in columns
    assert ("category",) in columns


def test_poi_metadata_is_immutable():
    poi = POI(
        id="node:1",
        osm_type="node",
        osm_id=1,
        name="Test park",
        latitude=51.1,
        longitude=71.4,
        category="park",
        description=None,
        opening_hours=None,
        source="OpenStreetMap",
        collected_at="2026-10-17T00:00:00Z",
        tags_json="{}",
    )
    with pytest.raises(FrozenInstanceError):
        poi.name = "Changed"
