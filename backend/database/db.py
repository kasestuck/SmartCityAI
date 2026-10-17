"""Short-lived SQLite connections and initial POI schema."""

import sqlite3
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from dataclasses import astuple
from pathlib import Path

from backend.database.models import POI

SCHEMA = """
CREATE TABLE IF NOT EXISTS poi (
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
);
CREATE INDEX IF NOT EXISTS idx_poi_geography ON poi (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_poi_category ON poi (category);
"""


class Database:
    def __init__(self, path: Path):
        self.path = path

    @contextmanager
    def connection(self, *, readonly: bool = False) -> Iterator[sqlite3.Connection]:
        if readonly:
            connection = sqlite3.connect(self.path.resolve().as_uri() + "?mode=ro", uri=True)
        else:
            connection = sqlite3.connect(self.path)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as connection:
            connection.executescript(SCHEMA)

    def check_health(self) -> None:
        with self.connection(readonly=True) as connection:
            connection.execute("SELECT 1 FROM poi LIMIT 1").fetchone()

    def upsert_pois(self, pois: Iterable[POI]) -> int:
        """Insert or update OSM identities in one transaction; return processed rows."""
        statement = """
            INSERT INTO poi (
                id, osm_type, osm_id, name, latitude, longitude, category,
                description, opening_hours, source, collected_at, tags_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(osm_type, osm_id) DO UPDATE SET
                id=excluded.id, name=excluded.name, latitude=excluded.latitude,
                longitude=excluded.longitude, category=excluded.category,
                description=excluded.description, opening_hours=excluded.opening_hours,
                source=excluded.source, collected_at=excluded.collected_at,
                tags_json=excluded.tags_json
        """
        saved = 0
        with self.connection() as connection:
            for poi in pois:
                connection.execute(statement, astuple(poi))
                saved += 1
        return saved
