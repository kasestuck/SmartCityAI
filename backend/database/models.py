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
    wheelchair: str | None = None
    phone: str | None = None
    website: str | None = None
    wikidata: str | None = None


@dataclass(frozen=True)
class TransitStop:
    """A mapped stop, not proof of a currently operating public-transport service."""

    id: str
    name: str | None
    latitude: float
    longitude: float
    stop_type: str
    route_refs: str | None
    collected_at: str
