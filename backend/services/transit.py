"""Nearby OSM stopping points, not public-transport routes or timetables."""

import re
from dataclasses import replace

from backend.database.db import Database
from backend.schemas import NearestTransitStop
from backend.services.geo_search import Candidate, haversine_meters

TRANSIT_RADIUS_METERS = 500.0


def attach_nearest_stops(database: Database, candidates: list[Candidate]) -> list[Candidate]:
    """Annotate already-ranked candidates, measuring from each POI, not the user."""
    if not candidates:
        return candidates
    with database.connection(readonly=True) as connection:
        stops = connection.execute(
            "SELECT id, name, latitude, longitude, stop_type, route_refs FROM transit_stops"
        ).fetchall()
    annotated = []
    for candidate in candidates:
        nearby = []
        for identity, name, latitude, longitude, stop_type, route_refs in stops:
            distance = haversine_meters(
                candidate.poi.latitude, candidate.poi.longitude, latitude, longitude
            )
            if distance <= TRANSIT_RADIUS_METERS:
                nearby.append(
                    (
                        distance,
                        identity,
                        NearestTransitStop(
                            name=name,
                            stop_type=stop_type,
                            distance_meters=round(distance, 1),
                            route_refs=route_refs,
                        ),
                    )
                )
        nearest = min(nearby, key=lambda item: (item[0], item[1]))[2] if nearby else None
        annotated.append(replace(candidate, nearest_transit_stop=nearest))
    return annotated


_TRANSIT = re.compile(
    r"автобус\w*|маршрут\w*|\bлрт\b|трамва\w*|остановк\w*|аялдама\w*|бағыт\w*|"
    r"\b(?:bus(?:es)?|tram(?:s)?|lrt|transit|routes?|stops?|stations?|light rail)\b",
    re.IGNORECASE,
)
_UNSUPPORTED_SERVICE = re.compile(
    r"ожидан\w*|ожида\w*|подожд\w*|ждите|расписан\w*|интервал\w*|"
    r"күті\w*|кесте\w*|\b(?:wait\w*|schedule\w*|timetable\w*|headway\w*)\b",
    re.IGNORECASE,
)
_UNSUPPORTED_TRAVEL = re.compile(
    r"ожидан\w*|ожида\w*|подожд\w*|ждите|расписан\w*|интервал\w*|кажды\w*|"
    r"минут\w*|\bмин\b|\bсек\b|время\s+в\s+пути|час(?:а|ов)?\b|быстр\w*|пересад\w*|пересяд\w*|сядьте|садитесь|"
    r"выйдите|проед\w*|доед\w*|күті\w*|кесте\w*|сағат\w*|сайын|жылдам\w*|\bтез\b|"
    r"отыры\w*|ауысып|"
    r"\b(?:wait\w*|every|schedule\w*|timetable\w*|headway\w*|arriv\w*|depart\w*|"
    r"minutes?|mins?|hours?|faster|quicker|transfer\w*|board(?:ing)?|ride)\b|"
    r"\btake\s+(?:the\s+)?(?:bus|tram|lrt)\b|\b\d{1,2}:\d{2}\b",
    re.IGNORECASE,
)
# Once a text mentions transit, every numeric claim must be supplied by OSM
# (route identifiers) or be the measured distance. This also checks route lists.
_NUMBER = re.compile(r"\b\d+(?:[.,]\d+)?[a-zа-я]?\b", re.IGNORECASE)
_DISTANCE = re.compile(r"\b(\d+(?:[.,]\d+)?)\s*(?:м(?:етр\w*)?|m|meters?|metres?)\b", re.IGNORECASE)
_MODES = {
    "bus": re.compile(r"автобус\w*|\bbus(?:es)?\b", re.IGNORECASE),
    "lrt": re.compile(r"\b(?:лрт|lrt|light rail)\b", re.IGNORECASE),
    "tram": re.compile(r"трамва\w*|\btrams?\b", re.IGNORECASE),
}


def valid_transit_text(text: str, stop: NearestTransitStop | None) -> bool:
    """Add a conservative transit guard without weakening the existing text guard."""
    # Waiting or timetable claims remain unsupported even without a bus/stop keyword.
    if _UNSUPPORTED_SERVICE.search(text):
        return False
    if not _TRANSIT.search(text):
        return True
    if stop is None:
        return False
    # Digits in an actual stop name (e.g. School 12) are not route numbers.
    factual_text = text.casefold()
    if stop.name:
        factual_text = factual_text.replace(stop.name.casefold(), "")
    if _UNSUPPORTED_TRAVEL.search(factual_text):
        return False
    if any(
        pattern.search(factual_text) and mode != stop.stop_type for mode, pattern in _MODES.items()
    ):
        return False
    allowed = {token.casefold() for token in re.split(r"[\s;,/|]+", stop.route_refs or "") if token}
    distances = list(_DISTANCE.finditer(factual_text))
    if any(
        abs(float(match.group(1).replace(",", ".")) - stop.distance_meters) > 1
        for match in distances
    ):
        return False
    without_distance = _DISTANCE.sub("", factual_text)
    return all(number.casefold() in allowed for number in _NUMBER.findall(without_distance))
