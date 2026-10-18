"""Collect named real OSM POI; cached responses retain their original dates."""

import hashlib
import json
import math
import os
import tempfile
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from http.client import HTTPException
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from backend.config import Settings
from backend.database.db import Database
from backend.database.models import POI
from backend.services.poi_names import meaningful_name

# First matching rule wins; keep this order stable when tags overlap.
CATEGORY_RULES = (
    ("amenity", "cafe"),
    ("amenity", "restaurant"),
    ("leisure", "park"),
    ("tourism", "museum"),
    ("tourism", "attraction"),
    ("tourism", "viewpoint"),
    ("leisure", "playground"),
)
MAX_RETRY_DELAY_SECONDS = 60.0
MAX_RESPONSE_BYTES = 32 * 1024 * 1024


class CollectionError(Exception):
    """Public collector failure with a safe message, without response bodies or URLs."""


@dataclass(frozen=True)
class CollectionResult:
    received: int
    saved: int
    skipped: int
    from_cache: bool
    collected_at: str


def utc_now() -> datetime:
    return datetime.now(UTC)


def build_query(settings: Settings) -> str:
    bbox = ",".join(str(value) for value in settings.overpass_bbox)
    selections = "".join(f'nwr["{key}"="{value}"]({bbox});' for key, value in CATEGORY_RULES)
    timeout = max(1, math.ceil(settings.overpass_timeout_seconds))
    return f"[out:json][timeout:{timeout}];({selections});out center;"


def _text(tags: dict, *keys: str) -> str | None:
    for key in keys:
        value = tags.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def normalize_element(element: dict, collected_at: str, source: str) -> POI | None:
    """Skip incomplete POI; never fill unavailable facts with guesses."""
    osm_type, osm_id = element.get("type"), element.get("id")
    tags = element.get("tags", {})
    if osm_type not in ("node", "way", "relation") or type(osm_id) is not int or osm_id <= 0:
        return None
    if not isinstance(tags, dict):
        return None
    name = meaningful_name(tags)
    category = next((value for key, value in CATEGORY_RULES if tags.get(key) == value), None)
    coordinates = element if osm_type == "node" else element.get("center", {})
    if not isinstance(coordinates, dict):
        return None
    latitude, longitude = coordinates.get("lat"), coordinates.get("lon")
    if not name or not category:
        return None
    if any(
        type(value) not in (int, float) or not math.isfinite(value)
        for value in (latitude, longitude)
    ):
        return None
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        return None
    return POI(
        id=f"osm_{osm_type}_{osm_id}",
        osm_type=osm_type,
        osm_id=osm_id,
        name=name,
        latitude=float(latitude),
        longitude=float(longitude),
        category=category,
        description=_text(
            tags, "description", "description:ru", "description:kk", "description:en"
        ),
        opening_hours=_text(tags, "opening_hours"),
        source=source,
        collected_at=collected_at,
        tags_json=json.dumps(tags, ensure_ascii=False, sort_keys=True),
        wheelchair=_text(tags, "wheelchair"),
        phone=_text(tags, "phone", "contact:phone"),
        website=_text(tags, "website", "contact:website"),
        wikidata=_text(tags, "wikidata"),
    )


def _validate_payload(payload: object) -> dict:
    if not isinstance(payload, dict) or "remark" in payload:
        raise CollectionError("Overpass returned an incomplete or invalid response.")
    elements = payload.get("elements")
    if not isinstance(elements, list):
        raise CollectionError("Overpass returned invalid elements.")
    for element in elements:
        if not isinstance(element, dict):
            raise CollectionError("Overpass returned invalid elements.")
        if (
            element.get("type") not in ("node", "way", "relation")
            or type(element.get("id")) is not int
        ):
            raise CollectionError("Overpass returned invalid element identities.")
        tags = element.get("tags", {})
        if not isinstance(tags, dict) or any(
            not isinstance(key, str) or not isinstance(value, str) for key, value in tags.items()
        ):
            raise CollectionError("Overpass returned invalid tags.")
    return payload


def _retry_delay(error: HTTPError, default: float) -> float:
    value = error.headers.get("Retry-After") if error.headers else None
    delay = default
    if value:
        try:
            delay = float(value)
        except ValueError:
            try:
                when = parsedate_to_datetime(value)
                if when.tzinfo is None:
                    when = when.replace(tzinfo=UTC)
                delay = max(0.0, (when - utc_now()).total_seconds())
            except (TypeError, ValueError, OverflowError):
                delay = default
    if not math.isfinite(delay) or delay > MAX_RETRY_DELAY_SECONDS:
        raise CollectionError("Overpass requested a retry later; run collection again later.")
    return max(0.0, delay)


def download_overpass(settings: Settings, query: str, *, opener=None, sleeper=None) -> dict:
    """Bounded urllib requests; injection keeps tests independent of the network."""
    opener = opener or urlopen
    sleeper = sleeper or time.sleep
    try:
        endpoint = urlsplit(settings.overpass_url)
        if endpoint.scheme not in ("http", "https") or not endpoint.hostname:
            raise ValueError("Invalid HTTP endpoint")
        request = Request(
            settings.overpass_url,
            data=urlencode({"data": query}).encode("utf-8"),
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "SmartCityPOI/1.0 (OpenStreetMap collector)",
                "Accept": "application/json",
            },
            method="POST",
        )
    except ValueError:
        raise CollectionError("Check the Overpass endpoint configuration.") from None
    for attempt in range(settings.overpass_attempts):
        delay = min(settings.overpass_retry_delay_seconds, MAX_RETRY_DELAY_SECONDS)
        try:
            with opener(request, timeout=settings.overpass_timeout_seconds) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                raise CollectionError("Overpass response is too large.")
            try:
                return _validate_payload(json.loads(raw))
            except (ValueError, UnicodeError):
                raise CollectionError("Overpass returned invalid JSON.") from None
        except HTTPError as error:
            if error.code != 429 and not 500 <= error.code <= 599:
                raise CollectionError("Overpass rejected the collection request.") from None
            if attempt + 1 < settings.overpass_attempts:
                delay = _retry_delay(error, delay)
        except (URLError, TimeoutError, OSError, HTTPException):
            pass
        if attempt + 1 < settings.overpass_attempts:
            sleeper(delay)
    raise CollectionError("Overpass is unavailable after bounded retries.") from None


def _parse_timestamp(value: object) -> datetime:
    if not isinstance(value, str):
        raise ValueError("Missing date")
    timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if timestamp.tzinfo is None:
        raise ValueError("Missing timezone")
    return timestamp.astimezone(UTC)


def _cache_key(settings: Settings, query: str) -> str:
    return hashlib.sha256(f"{settings.overpass_url}\n{query}".encode()).hexdigest()


def _read_cache(settings: Settings, key: str, now: datetime) -> tuple[dict, str] | None:
    try:
        cache = json.loads(settings.poi_cache_path.read_text(encoding="utf-8"))
        if not isinstance(cache, dict) or cache.get("key") != key:
            return None
        fetched_at = _parse_timestamp(cache.get("collected_at"))
        age = (now - fetched_at).total_seconds()
        if not 0 <= age < settings.poi_cache_ttl_seconds:
            return None
        return _validate_payload(cache.get("payload")), fetched_at.isoformat()
    except (OSError, ValueError, TypeError, CollectionError):
        return None


def _write_cache(path: Path, key: str, payload: dict, collected_at: str) -> None:
    """Replace only a complete serialized response, using a sibling temporary file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            json.dump(
                {"key": key, "collected_at": collected_at, "payload": payload},
                temporary,
                ensure_ascii=False,
                allow_nan=False,
            )
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_path, path)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def collect_poi(settings: Settings, database: Database, *, force: bool = False) -> CollectionResult:
    now = utc_now()
    query = build_query(settings)
    key = _cache_key(settings, query)
    cached = None if force else _read_cache(settings, key, now)
    if cached is None:
        payload = _validate_payload(download_overpass(settings, query))
        collected_at = now.isoformat()
    else:
        payload, collected_at = cached
    source = "OpenStreetMap"
    pois = {}
    for element in payload["elements"]:
        poi = normalize_element(element, collected_at, source)
        if poi is not None:
            pois[poi.id] = poi
    # Validate serialization before any database or cache changes.
    try:
        json.dumps(payload, allow_nan=False)
    except (ValueError, TypeError):
        raise CollectionError("Overpass returned invalid numeric data.") from None
    saved = database.upsert_pois(pois.values())
    if cached is None:
        try:
            _write_cache(settings.poi_cache_path, key, payload, collected_at)
        except OSError:
            raise CollectionError(
                "POI were saved, but the collection cache could not be written."
            ) from None
    received = len(payload["elements"])
    return CollectionResult(received, saved, received - saved, cached is not None, collected_at)
