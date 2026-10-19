"""Collect OSM transit stop facts without routes, schedules or operating-status guesses."""

import json
import math

from backend.config import Settings
from backend.database.db import Database
from backend.database.models import TransitStop
from backend.services.poi_collector import (
    CollectionError,
    CollectionResult,
    _cache_key,
    _read_cache,
    _validate_payload,
    _write_cache,
    download_overpass,
    utc_now,
)
from backend.services.poi_names import meaningful_name

_STOP_VALUES = {"stop", "stop_position", "platform", "station"}
_RAIL_STOP_VALUES = {"station", "halt", "stop", "platform", "tram_stop"}
_INACTIVE = {"construction", "proposed", "disused", "abandoned", "demolished"}


def build_query(settings: Settings) -> str:
    """Include observed Astana formats; normalization rejects tracks and inactive objects."""
    bbox = ",".join(str(value) for value in settings.overpass_bbox)
    timeout = max(1, math.ceil(settings.overpass_timeout_seconds))
    return (
        f"[out:json][timeout:{timeout}];("
        f'nwr["public_transport"~"^(stop|stop_position|platform|station)$"]({bbox});'
        f'nwr["highway"="bus_stop"]({bbox});'
        f'nwr["railway"~"^(tram_stop|station|halt|platform|light_rail)$"]({bbox});'
        f'nwr["station"="light_rail"]({bbox});'
        f'nwr["construction"="station"]({bbox}););out center;'
    )


def _stop_type(tags: dict) -> str | None:
    if tags.get("railway") in _INACTIVE:
        return None
    for key, value in tags.items():
        if key.split(":", 1)[0] in _INACTIVE and str(value).strip().lower() not in ("", "no"):
            return None
    public_stop = tags.get("public_transport") in _STOP_VALUES
    rail_stop = tags.get("railway") in _RAIL_STOP_VALUES
    if (tags.get("light_rail") == "yes" or tags.get("station") == "light_rail") and (
        public_stop or rail_stop
    ):
        return "lrt"
    if tags.get("railway") == "tram_stop" or (tags.get("tram") == "yes" and public_stop):
        return "tram"
    if tags.get("highway") == "bus_stop" or (tags.get("bus") == "yes" and public_stop):
        return "bus"
    return None


def normalize_element(element: dict, collected_at: str) -> TransitStop | None:
    """Keep unnamed stop coordinates, but never turn an OSM ref/id into its name."""
    osm_type, osm_id = element.get("type"), element.get("id")
    tags = element.get("tags", {})
    if osm_type not in ("node", "way", "relation") or type(osm_id) is not int or osm_id <= 0:
        return None
    if not isinstance(tags, dict):
        return None
    stop_type = _stop_type(tags)
    if stop_type is None:
        return None
    coordinates = element if osm_type == "node" else element.get("center", {})
    if not isinstance(coordinates, dict):
        return None
    latitude, longitude = coordinates.get("lat"), coordinates.get("lon")
    if any(
        type(value) not in (int, float) or not math.isfinite(value)
        for value in (latitude, longitude)
    ):
        return None
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        return None
    route_refs = tags.get("route_ref")
    route_refs = route_refs.strip() if isinstance(route_refs, str) and route_refs.strip() else None
    return TransitStop(
        id=f"osm_{osm_type}_{osm_id}",
        name=meaningful_name(tags),
        latitude=float(latitude),
        longitude=float(longitude),
        stop_type=stop_type,
        route_refs=route_refs,
        collected_at=collected_at,
    )


def collect_transit(
    settings: Settings, database: Database, *, force: bool = False
) -> CollectionResult:
    """Reuse POI HTTP/cache safeguards; upsert validated facts without deleting old rows."""
    cache_settings = settings.model_copy(update={"poi_cache_path": settings.transit_cache_path})
    now = utc_now()
    query = build_query(settings)
    key = _cache_key(cache_settings, query)
    cached = None if force else _read_cache(cache_settings, key, now)
    if cached is None:
        payload = _validate_payload(download_overpass(settings, query))
        collected_at = now.isoformat()
    else:
        payload, collected_at = cached
    stops = {}
    for element in payload["elements"]:
        stop = normalize_element(element, collected_at)
        if stop is not None:
            stops[stop.id] = stop
    try:
        json.dumps(payload, allow_nan=False)
    except (ValueError, TypeError):
        raise CollectionError("Overpass returned invalid numeric data.") from None
    saved = database.upsert_transit_stops(stops.values())
    if cached is None:
        try:
            _write_cache(settings.transit_cache_path, key, payload, collected_at)
        except OSError:
            raise CollectionError(
                "Transit stops were saved, but the collection cache could not be written."
            ) from None
    received = len(payload["elements"])
    return CollectionResult(received, saved, received - saved, cached is not None, collected_at)
