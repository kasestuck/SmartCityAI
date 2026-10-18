"""Geographic retrieval and deterministic ranking of collected POI."""

import json
import math
import re
import sqlite3
from dataclasses import dataclass, fields

from backend.database.db import Database
from backend.database.models import POI
from backend.schemas import RecommendationRequest

EARTH_RADIUS_METERS = 6_371_008.8
WALKING_METERS_PER_MINUTE = 75
WALKING_DISTANCE_FACTOR = 1.3
VISIT_MINUTES = {
    "cafe": 20,
    "restaurant": 45,
    "park": 20,
    "museum": 45,
    "attraction": 20,
    "viewpoint": 10,
    "playground": 20,
}
INTENTS = (
    (("коф", "кафе", "coffee", "cafe", "café"), {"cafe"}),
    (("прогул", "гуля", "парк", "walk", "stroll", "park"), {"park", "attraction", "viewpoint"}),
    (("ребен", "дет", "семь", "семей", "family", "kid", "child"), {"park", "playground", "museum"}),
    (
        ("турист", "достопримеч", "музе", "tourist", "sightseeing", "museum"),
        {"museum", "attraction", "viewpoint"},
    ),
)


@dataclass(frozen=True)
class Candidate:
    poi: POI
    distance_meters: float
    estimated_duration_minutes: int
    score: float


def _validate_coordinates(latitude: float, longitude: float) -> None:
    if (
        not math.isfinite(latitude)
        or not math.isfinite(longitude)
        or not -90 <= latitude <= 90
        or not -180 <= longitude <= 180
    ):
        raise ValueError("Coordinates must be finite and within WGS84 bounds")


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return the shortest great-circle distance in meters."""
    _validate_coordinates(lat1, lon1)
    _validate_coordinates(lat2, lon2)
    if lat1 == lat2 and (abs(lat1) == 90 or (lon2 - lon1) % 360 == 0):
        return 0.0
    lat1_radians, lat2_radians = math.radians(lat1), math.radians(lat2)
    latitude_delta = lat2_radians - lat1_radians
    longitude_delta = math.radians((lon2 - lon1 + 180) % 360 - 180)
    half_chord = (
        math.sin(latitude_delta / 2) ** 2
        + math.cos(lat1_radians) * math.cos(lat2_radians) * math.sin(longitude_delta / 2) ** 2
    )
    return 2 * EARTH_RADIUS_METERS * math.asin(math.sqrt(min(1, max(0, half_chord))))


def _bounding_box(latitude: float, longitude: float, radius: float) -> tuple[str, list]:
    """Build a spherical bounding box, wrapping longitudes across the dateline."""
    angular_radius = radius / EARTH_RADIUS_METERS
    latitude_delta = math.degrees(angular_radius)
    south = max(-90, latitude - latitude_delta)
    north = min(90, latitude + latitude_delta)
    clause = "latitude BETWEEN ? AND ?"
    parameters = [south, north]
    if south <= -90 or north >= 90:
        return clause, parameters
    longitude_delta = math.degrees(
        math.asin(min(1, math.sin(angular_radius) / math.cos(math.radians(latitude))))
    )
    west = longitude - longitude_delta
    east = longitude + longitude_delta
    if west <= -180:
        west += 360
        clause += " AND (longitude >= ? OR longitude <= ?)"
    elif east >= 180:
        east -= 360
        clause += " AND (longitude >= ? OR longitude <= ?)"
    else:
        clause += " AND longitude BETWEEN ? AND ?"
    return clause, [*parameters, west, east]


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"[^\W_]+", text.casefold().replace("ё", "е")))


def _intent_categories(tokens: set[str]) -> set[str]:
    categories = set()
    for prefixes, matches in INTENTS:
        if any(token.startswith(prefix) for token in tokens for prefix in prefixes):
            categories.update(matches)
    return categories


def _tag_text(tags_json: str) -> str:
    try:
        tags = json.loads(tags_json)
    except (ValueError, TypeError):
        return ""
    if not isinstance(tags, dict):
        return ""
    return " ".join(value for value in tags.values() if isinstance(value, str))


def search_poi(
    database: Database,
    request: RecommendationRequest,
    limit: int = 12,
) -> list[Candidate]:
    """Retrieve real, reachable alternatives without creating navigation routes."""
    _validate_coordinates(request.latitude, request.longitude)
    if limit <= 0:
        return []
    categories = (
        sorted(set(request.categories) & VISIT_MINUTES.keys())
        if request.categories
        else (sorted(VISIT_MINUTES))
    )
    if not categories:
        return []
    available_walking_minutes = request.duration_minutes - min(
        VISIT_MINUTES[category] for category in categories
    )
    radius = max(0, available_walking_minutes) * WALKING_METERS_PER_MINUTE / WALKING_DISTANCE_FACTOR
    fallback_radius = request.duration_minutes * WALKING_METERS_PER_MINUTE / WALKING_DISTANCE_FACTOR
    clause, parameters = _bounding_box(request.latitude, request.longitude, fallback_radius)
    clause += f" AND category IN ({', '.join('?' for _ in categories)})"
    parameters.extend(categories)
    columns = ", ".join(field.name for field in fields(POI))
    with database.connection(readonly=True) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            f"SELECT {columns} FROM poi WHERE {clause}",
            parameters,
        ).fetchall()
    query_tokens = _tokens(request.query)
    intent_categories = set(categories) if request.categories else _intent_categories(query_tokens)
    candidates = []
    fallback_candidates = []
    for row in rows:
        poi = POI(**dict(row))
        distance = haversine_meters(
            request.latitude,
            request.longitude,
            poi.latitude,
            poi.longitude,
        )
        if distance > fallback_radius:
            continue
        duration = math.ceil(distance * WALKING_DISTANCE_FACTOR / WALKING_METERS_PER_MINUTE)
        duration += VISIT_MINUTES[poi.category]
        place_tokens = _tokens(
            " ".join(
                (
                    poi.name,
                    poi.description or "",
                    _tag_text(poi.tags_json),
                )
            )
        )
        text_score = len(query_tokens & place_tokens) / len(query_tokens) if query_tokens else 0
        category_score = float(poi.category in intent_categories)
        proximity_score = max(0, 1 - distance / radius) if radius else float(distance == 0)
        score = 0.5 * category_score + 0.3 * text_score + 0.2 * proximity_score
        candidate = Candidate(poi, distance, duration, score)
        if duration <= request.duration_minutes:
            candidates.append(candidate)
        elif not intent_categories or poi.category in intent_categories:
            fallback_candidates.append(candidate)
    if not candidates and fallback_candidates:
        # Keep the full visit estimate, but offer only a place within the walking budget.
        return [
            min(
                fallback_candidates,
                key=lambda candidate: (
                    candidate.estimated_duration_minutes,
                    candidate.distance_meters,
                    candidate.poi.id,
                ),
            )
        ]
    candidates.sort(
        key=lambda candidate: (
            -candidate.score,
            candidate.distance_meters,
            candidate.poi.id,
        )
    )
    return candidates[: min(limit, 12)]
