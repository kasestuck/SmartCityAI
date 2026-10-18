"""Снимок мест Астаны из OpenStreetMap для слоя «Все места» на экране «Карта».

Повторяет правила сборщика бекенда (backend/services/poi_collector.py в ветке BACK):
тот же прямоугольник, те же 7 категорий, тот же приоритет имён, центр для way/relation.
Когда у бекенда появится GET /api/poi, фронт возьмёт данные оттуда, а этот снимок
останется запасным вариантом.

Запуск из корня репозитория:  python tools/build_poi_snapshot.py
Результат: data/poi-astana.json. Данные © OpenStreetMap contributors, ODbL.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.services.poi_names import meaningful_name  # noqa: E402

# Основной сервер и зеркало: Overpass иногда отвечает 502/504.
OVERPASS_URLS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
)
ATTEMPTS = 3
BBOX = (50.95, 71.20, 51.30, 71.75)  # south, west, north, east — как OVERPASS_BBOX бекенда
CATEGORY_RULES = (
    ("amenity", "cafe"),
    ("amenity", "restaurant"),
    ("leisure", "park"),
    ("tourism", "museum"),
    ("tourism", "attraction"),
    ("tourism", "viewpoint"),
    ("leisure", "playground"),
)
OUT = Path(__file__).resolve().parent.parent / "data" / "poi-astana.json"


def build_query() -> str:
    bbox = ",".join(str(v) for v in BBOX)
    selections = "".join(f'nwr["{k}"="{v}"]({bbox});' for k, v in CATEGORY_RULES)
    return f"[out:json][timeout:90];({selections});out center tags;"


def download() -> dict:
    body = urllib.parse.urlencode({"data": build_query()}).encode()
    last_error: Exception | None = None
    for attempt in range(ATTEMPTS):
        for url in OVERPASS_URLS:
            request = urllib.request.Request(
                url, data=body, headers={"User-Agent": "SmartCityAI-frontend-snapshot/1.0"}
            )
            try:
                with urllib.request.urlopen(request, timeout=120) as response:
                    payload = json.load(response)
                if isinstance(payload.get("elements"), list):
                    return payload
            except Exception as error:  # сеть, 429/502/504, битый JSON
                last_error = error
                print(f"attempt {attempt + 1} {url}: {error}", file=sys.stderr)
        time.sleep(5 * (attempt + 1))
    raise SystemExit(f"Overpass недоступен: {last_error}")


def main() -> int:
    payload = download()

    places, seen = [], set()
    for element in payload.get("elements", []):
        tags = element.get("tags") or {}
        name = meaningful_name(tags)
        category = next((v for k, v in CATEGORY_RULES if tags.get(k) == v), None)
        lat = element.get("lat", (element.get("center") or {}).get("lat"))
        lon = element.get("lon", (element.get("center") or {}).get("lon"))
        if not name or not category or lat is None or lon is None:
            continue
        poi_id = f"osm_{element['type']}_{element['id']}"
        if poi_id in seen:
            continue
        seen.add(poi_id)
        places.append([poi_id, name, round(lat, 6), round(lon, 6), category])

    places.sort(key=lambda p: (p[4], p[1]))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "source": "OpenStreetMap",
                "license": "ODbL — © OpenStreetMap contributors",
                "collected_at": datetime.now(UTC).replace(microsecond=0).isoformat(),
                "fields": ["id", "name", "latitude", "longitude", "category"],
                "places": places,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    counts: dict[str, int] = {}
    for place in places:
        counts[place[4]] = counts.get(place[4], 0) + 1
    print(f"saved {len(places)} places to {OUT}: {counts}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
