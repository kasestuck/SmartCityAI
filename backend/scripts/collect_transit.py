"""Run with python -m backend.scripts.collect_transit or directly from the repository."""

import argparse
import sqlite3
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pydantic import ValidationError  # noqa: E402

from backend.config import Settings  # noqa: E402
from backend.database.db import Database  # noqa: E402
from backend.services.poi_collector import CollectionError  # noqa: E402
from backend.services.transit_collector import collect_transit  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Collect Astana transit stops from OSM/Overpass.")
    parser.add_argument("--force", action="store_true", help="Bypass the response cache.")
    arguments = parser.parse_args(argv)
    try:
        settings = Settings()
        database = Database(settings.database_path)
        database.initialize()
        print(
            "Collecting OSM transit stops: checking cache and downloading if needed...", flush=True
        )
        result = collect_transit(settings, database, force=arguments.force)
    except CollectionError as error:
        print(f"Collection failed: {error}", file=sys.stderr)
        return 1
    except (ValidationError, OSError, sqlite3.Error):
        print(
            "Collection failed: check configuration and local database/cache access.",
            file=sys.stderr,
        )
        return 1
    origin = "cache" if result.from_cache else "network"
    print(
        f"Source: OpenStreetMap contributors (ODbL), via Overpass; {origin}; "
        f"collected_at={result.collected_at}"
    )
    print(f"received={result.received} saved={result.saved} skipped={result.skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
