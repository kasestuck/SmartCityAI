"""Data carried by a collected point of interest."""

from dataclasses import dataclass


@dataclass(frozen=True)
class POI:
    id: str
    osm_type: str
    osm_id: int
    name: str
    latitude: float
    longitude: float
    category: str
    description: str | None
    opening_hours: str | None
    source: str
    collected_at: str
    tags_json: str
