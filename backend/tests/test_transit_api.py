"""Transit metadata and factual-text regressions through real SQLite and FastAPI.

Only Gemini's external HTTP transport is replaced; distances use fixed independent
coordinates and hand-calculated expectations. No external service or .env is used.
"""

import io
import json

import pytest
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.database.models import POI
from backend.main import create_app
from backend.services.gemini import GeminiClient

# Observed OSM stop: node/13081694260, Бәйтерек, railway=stop,
# public_transport=stop_position, light_rail=yes.
# The test POI is exactly 0.001 latitude degrees north.
STOP_LAT = 51.1232327
STOP_LON = 71.428798
POI_LAT = STOP_LAT + 0.001


@pytest.fixture
def app(tmp_path):
    return create_app(
        Settings(
            _env_file=None,
            database_path=tmp_path / "transit-api.sqlite3",
            gemini_api_key="",
        )
    )


@pytest.fixture
def client(app):
    with TestClient(app) as test_client:
        yield test_client


def seed_poi(app, *, identity=1, latitude=POI_LAT, longitude=STOP_LON):
    app.state.database.upsert_pois(
        [
            POI(
                id=f"osm_node_{identity}",
                osm_type="node",
                osm_id=identity,
                name=f"Тестовое кафе Альфа {identity}",
                latitude=latitude,
                longitude=longitude,
                category="cafe",
                description=None,
                opening_hours=None,
                source="OpenStreetMap",
                collected_at="2026-10-19T00:00:00Z",
                tags_json="{}",
            )
        ]
    )


def seed_stop(
    app,
    *,
    identity="osm_node_13081694260",
    name="Бәйтерек",
    latitude=STOP_LAT,
    longitude=STOP_LON,
    stop_type="lrt",
    route_refs=None,
):
    # Independent SQL fixture permits RED tests before the production migration.
    with app.state.database.connection() as connection:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS transit_stops (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                stop_type TEXT NOT NULL,
                route_refs TEXT,
                collected_at TEXT NOT NULL
            )"""
        )
        connection.execute(
            """INSERT INTO transit_stops
               (id, name, latitude, longitude, stop_type, route_refs, collected_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                identity,
                name,
                latitude,
                longitude,
                stop_type,
                route_refs,
                "2026-10-19T00:00:00Z",
            ),
        )


def post(client, **overrides):
    response = client.post(
        "/api/recommendations",
        json={
            "latitude": POI_LAT,
            "longitude": STOP_LON,
            "query": "Хочу кофе",
            "duration_minutes": 60,
            "transport": "walking",
            **overrides,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def install_gemini(app, *, reason="Подходит для короткой паузы.", action="Уточнить условия."):
    captured = []

    def transport(http_request, *, timeout):
        envelope = json.loads(http_request.data.decode("utf-8"))
        data = json.loads(envelope["contents"][0]["parts"][0]["text"])
        captured.append(data)
        generated = {
            "recommendations": [
                {
                    "id": data["candidates"][0]["id"],
                    "reason": reason,
                    "suggested_action": action,
                }
            ]
        }
        return io.BytesIO(
            json.dumps(
                {
                    "candidates": [
                        {
                            "finishReason": "STOP",
                            "content": {"parts": [{"text": json.dumps(generated)}]},
                        }
                    ]
                }
            ).encode("utf-8")
        )

    app.state.gemini = GeminiClient(
        Settings(_env_file=None, gemini_api_key="test-only-not-a-real-key"),
        transport=transport,
    )
    return captured


def test_known_osm_lrt_stop_reaches_api_with_distance_from_place(client, app):
    seed_poi(app)
    seed_stop(app)
    card = post(client)["recommendations"][0]
    stop = card["nearest_transit_stop"]
    assert stop["name"] == "Бәйтерек"
    assert stop["stop_type"] == "lrt"
    assert stop["distance_meters"] == pytest.approx(111.195, abs=0.1)
    assert stop["route_refs"] is None
    assert card["distance_meters"] == 0


@pytest.mark.parametrize("distance_degrees", [0.0044, 0.0046], ids=["inside-500m", "outside-500m"])
def test_stop_radius_is_500_meters(client, app, distance_degrees):
    seed_poi(app)
    seed_stop(app, latitude=POI_LAT + distance_degrees)
    stop = post(client)["recommendations"][0]["nearest_transit_stop"]
    if distance_degrees == 0.0044:
        assert stop is not None
        assert stop["distance_meters"] == pytest.approx(489.258, abs=0.1)
    else:
        assert stop is None


@pytest.mark.parametrize("with_far_stop", [False, True], ids=["empty-table", "far-away"])
def test_absent_nearby_stop_is_null_without_request_failure(client, app, with_far_stop):
    seed_poi(app)
    if with_far_stop:
        seed_stop(app, latitude=52.0, longitude=72.0)
    assert post(client)["recommendations"][0]["nearest_transit_stop"] is None


def test_closest_stop_is_measured_from_poi_not_from_user(client, app):
    seed_poi(app)
    seed_stop(app, identity="near-place", name="У кафе", latitude=POI_LAT + 0.0001)
    seed_stop(app, identity="near-user", name="У пользователя", latitude=POI_LAT + 0.003)
    stop = post(client, latitude=POI_LAT + 0.003)["recommendations"][0]["nearest_transit_stop"]
    assert stop["name"] == "У кафе"
    assert stop["distance_meters"] == pytest.approx(11.1195, abs=0.1)


def test_stop_with_unknown_name_and_routes_remains_null_in_metadata(client, app):
    seed_poi(app)
    seed_stop(app, name=None, stop_type="bus")
    stop = post(client)["recommendations"][0]["nearest_transit_stop"]
    assert stop["name"] is None
    assert stop["route_refs"] is None
    assert stop["stop_type"] == "bus"


def test_transit_metadata_does_not_change_order_or_existing_fields(client, app):
    for number in range(1, 5):
        seed_poi(app, identity=number, latitude=POI_LAT + number * 0.0001)
    before = post(client)
    seed_stop(app)
    after = post(client)
    assert all(card["nearest_transit_stop"] is not None for card in after["recommendations"])
    for body in (before, after):
        for card in body["recommendations"]:
            card.pop("nearest_transit_stop", None)
    assert after == before


def test_real_gemini_transport_receives_transit_facts_without_losing_poi_fields(client, app):
    seed_poi(app)
    seed_stop(app, name="Тестовая остановка", stop_type="bus", route_refs="12;24")
    captured = install_gemini(app)
    card = post(client)["recommendations"][0]
    assert card["generated_by"] == "gemini"
    assert len(captured) == 1
    candidate = captured[0]["candidates"][0]
    assert candidate["nearest_transit_stop"] == card["nearest_transit_stop"]
    assert candidate["name"] == card["name"]
    assert candidate["category"] == "cafe"
    assert candidate["opening_hours"] is None
    assert candidate["distance_meters"] == 0
    assert candidate["estimated_duration_minutes"] == card["estimated_duration_minutes"]


UNSUPPORTED_TRANSIT_TEXT = [
    pytest.param("Ожидание 5 минут.", None, "ru", id="ru-wait-without-bus-word"),
    pytest.param("Wait 5 minutes.", None, "ru", id="en-wait-without-bus-word"),
    pytest.param("5 минут күтіңіз.", None, "kk", id="kk-wait-without-bus-word"),
    pytest.param("Рядом остановка автобусов 12 и 99.", "12", "ru", id="ru-second-route"),
    pytest.param("Nearby buses 12 and 99.", "12", "ru", id="en-second-route"),
    pytest.param("Аялдамада 12 және 99 автобустары бар.", "12", "kk", id="kk-second-route"),
    pytest.param("Рядом остановка; время в пути — 5 мин.", "12", "ru", id="abbreviated-time"),
    pytest.param("Рядом автобус 12.", None, "ru", id="ru-invented-route"),
    pytest.param("Nearby bus 12.", None, "ru", id="en-invented-route"),
    pytest.param("Жақын жерде 12-автобус бар.", None, "kk", id="kk-invented-route"),
    pytest.param("Рядом автобус 120.", "12;24", "ru", id="route-not-substring"),
    pytest.param("Автобус 12: ожидание 5 минут.", "12;24", "ru", id="ru-wait-time"),
    pytest.param("Wait 5 minutes for bus 12.", "12;24", "ru", id="en-wait-time"),
    pytest.param("12-автобусты 5 минут күтіңіз.", "12;24", "kk", id="kk-wait-time"),
    pytest.param("Автобус ходит каждые 10 минут.", None, "ru", id="ru-frequency"),
    pytest.param("Buses run every 10 minutes.", None, "ru", id="en-frequency"),
    pytest.param("Автобус әр 10 минут сайын жүреді.", None, "kk", id="kk-frequency"),
    pytest.param("На автобусе можно доехать быстрее.", None, "ru", id="unsupported-faster"),
]


@pytest.mark.parametrize("field", ["reason", "suggested_action"])
@pytest.mark.parametrize("text,routes,language", UNSUPPORTED_TRANSIT_TEXT)
def test_unsupported_transit_claims_fall_back_in_either_generated_field(
    client, app, field, text, routes, language
):
    seed_poi(app)
    seed_stop(app, name="Тестовая остановка", stop_type="bus", route_refs=routes)
    arguments = {"reason": text} if field == "reason" else {"action": text}
    install_gemini(app, **arguments)
    card = post(client, language=language)["recommendations"][0]
    assert card["generated_by"] == "fallback_template"
    assert text not in card["reason"]
    assert text not in card["suggested_action"]


@pytest.mark.parametrize("field", ["reason", "suggested_action"])
def test_no_nearby_stop_does_not_allow_a_generated_nearby_stop_claim(client, app, field):
    seed_poi(app)
    claim = "Рядом есть автобусная остановка."
    arguments = {"reason": claim} if field == "reason" else {"action": claim}
    install_gemini(app, **arguments)
    card = post(client)["recommendations"][0]
    assert card["generated_by"] == "fallback_template"
    assert card["nearest_transit_stop"] is None


@pytest.mark.parametrize(
    "action",
    [
        "Рядом остановка Тестовая остановка.",
        "Рядом остановка автобуса 12.",
        "Рядом остановка автобусов 12 и 24.",
        "Остановка Тестовая остановка примерно в 111 м по прямой.",
    ],
    ids=["name", "known-route", "known-routes", "distance"],
)
def test_supported_transit_facts_are_not_rejected(client, app, action):
    seed_poi(app)
    seed_stop(app, name="Тестовая остановка", stop_type="bus", route_refs="12;24")
    install_gemini(app, action=action)
    card = post(client)["recommendations"][0]
    assert card["generated_by"] == "gemini"
    assert card["suggested_action"] == action
