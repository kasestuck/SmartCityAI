"""Endpoint integration uses an actual temporary SQLite and fake external AI."""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.main import create_app


@pytest.fixture
def application(tmp_path):
    return create_app(
        Settings(
            _env_file=None,
            database_path=tmp_path / "poi.sqlite3",
            gemini_api_key="",
        )
    )


def populate(database):
    with database.connection() as connection:
        connection.executemany(
            """INSERT INTO poi (id, osm_type, osm_id, name, latitude, longitude,
               category, description, opening_hours, source, collected_at, tags_json)
               VALUES (?, 'node', ?, ?, ?, 71.42, ?, NULL, NULL,
                       'OpenStreetMap', '2026-10-17T00:00:00Z', '{}')""",
            [
                ("osm_node_1", 1, "Тестовое кафе", 51.0901, "cafe"),
                ("osm_node_2", 2, "Тестовый парк", 51.091, "park"),
                ("osm_node_3", 3, "Тестовый музей", 51.092, "museum"),
                ("osm_node_4", 4, "Тестовая площадка", 51.093, "playground"),
                ("osm_node_5", 5, "Далёкое кафе", 40.0, "cafe"),
            ],
        )


def request_body(**changes):
    return {
        "latitude": 51.09,
        "longitude": 71.42,
        "query": "Хочу кофе и прогулку",
        "duration_minutes": 60,
        "transport": "walking",
        **changes,
    }


def test_api_searches_real_database_and_falls_back_without_ai_key(application):
    with TestClient(application) as client:
        populate(application.state.database)
        response = client.post("/api/recommendations", json=request_body())
    assert response.status_code == 200
    assert response.json()["query_context"] == {
        "latitude": 51.09,
        "longitude": 71.42,
        "categories": ["cafe", "park"],
        "duration_minutes": 60,
        "transport": "walking",
    }
    cards = response.json()["recommendations"]
    assert len(cards) == 2
    assert {card["id"] for card in cards} == {"osm_node_1", "osm_node_2"}
    assert {card["category"] for card in cards} == {"cafe", "park"}
    for card in cards:
        assert card["source"] == "OpenStreetMap"
        assert card["description"] is None and card["opening_hours"] is None
        assert card["status_note"] == "Часы работы не подтверждены"
        assert card["generated_by"] == "fallback_template"
        assert card["reason"] and card["suggested_action"]
        assert 0 <= card["distance_meters"] < 500
        assert card["estimated_duration_minutes"] <= 60


def test_api_honors_explicit_category_and_insufficient_time(application):
    with TestClient(application) as client:
        populate(application.state.database)
        body = request_body(categories=["cafe"])
        response = client.post("/api/recommendations", json=body)
        assert [card["id"] for card in response.json()["recommendations"]] == ["osm_node_1"]
        body["duration_minutes"] = 15
        short_response = client.post("/api/recommendations", json=body)
        assert short_response.status_code == 200
        cards = short_response.json()["recommendations"]
        assert len(cards) == 1 and cards[0]["id"] == "osm_node_1"
        assert cards[0]["estimated_duration_minutes"] == 21
        assert cards[0]["budget_warning"] == "Превышает ваш бюджет на 6 минут"
        assert response.json()["recommendations"][0]["budget_warning"] is None


@pytest.mark.parametrize(
    ("hours", "expected"),
    [("Mo-Fr 09:00-18:00", False), ("24/7", True), (None, None), ("nonsense", None)],
)
def test_api_reports_osm_schedule_without_removing_closed_places(
    application, monkeypatch, hours, expected
):
    class Clock:
        @staticmethod
        def now(tz):
            return datetime(2026, 10, 18, 12, 0, tzinfo=UTC)

    monkeypatch.setattr("backend.services.rag.datetime", Clock, raising=False)
    with TestClient(application) as client:
        populate(application.state.database)
        with application.state.database.connection() as connection:
            connection.execute("UPDATE poi SET opening_hours=? WHERE id='osm_node_1'", (hours,))
        response = client.post("/api/recommendations", json=request_body(categories=["cafe"]))
    assert response.status_code == 200
    card = response.json()["recommendations"][0]
    assert card["is_open_now"] is expected
    assert card["opening_hours"] == hours
    if expected is None:
        assert card["status_note"] == "Часы работы не подтверждены"
    else:
        assert "OpenStreetMap" in card["status_note"]
        assert "уточните" in card["status_note"]


@pytest.mark.parametrize("wheelchair", ["yes", "no", "limited", None])
def test_osm_enrichment_reaches_api_unchanged(application, wheelchair):
    from backend.services.poi_collector import normalize_element

    tags = {"name": "OSM кафе", "amenity": "cafe"}
    if wheelchair is not None:
        tags.update(
            wheelchair=wheelchair,
            phone="+7 7172 123456",
            website="https://example.org",
            wikidata="Q123",
        )
    poi = normalize_element(
        {"type": "node", "id": 100, "lat": 51.09, "lon": 71.42, "tags": tags},
        "2026-10-18T00:00:00Z",
        "OpenStreetMap",
    )
    with TestClient(application) as client:
        application.state.database.upsert_pois([poi])
        response = client.post("/api/recommendations", json=request_body(categories=["cafe"]))
    assert response.status_code == 200
    card = response.json()["recommendations"][0]
    assert card["wheelchair"] == wheelchair
    assert card["accessibility"] == wheelchair
    for field in ("phone", "website", "wikidata"):
        assert card[field] == tags.get(field)


def test_kazakh_request_works_with_localized_fallback(application):
    with TestClient(application) as client:
        populate(application.state.database)
        response = client.post(
            "/api/recommendations",
            json=request_body(language="kk", query="Жақын жерде кофе", categories=["cafe"]),
        )
    assert response.status_code == 200
    assert response.json()["language"] == "kk"
    card = response.json()["recommendations"][0]
    assert card["generated_by"] == "fallback_template"
    assert "шамамен" in card["reason"]
    assert card["status_note"] == "Жұмыс уақыты расталмаған"


def test_default_language_and_empty_kazakh_result(application):
    with TestClient(application) as client:
        assert client.post("/api/recommendations", json=request_body()).json()["language"] == "ru"
        result = client.post("/api/recommendations", json=request_body(language="kk"))
        invalid = client.post("/api/recommendations", json=request_body(language="de"))
    assert result.status_code == 200
    assert result.json()["language"] == "kk"
    assert result.json()["recommendations"] == []
    assert invalid.status_code == 422


def test_api_accepts_generated_text_for_allowed_id_and_keeps_poi_facts(application):
    class Generator:
        def generate(self, request, candidates):
            return {
                "recommendations": [
                    {
                        "id": "osm_node_1",
                        "reason": "Подходит для спокойной паузы",
                        "suggested_action": "Выпить кофе",
                    }
                ]
            }

    application.state.gemini = Generator()
    with TestClient(application) as client:
        populate(application.state.database)
        response = client.post("/api/recommendations", json=request_body(categories=["cafe"]))
    card = response.json()["recommendations"][0]
    assert card["reason"] == "Подходит для спокойной паузы"
    assert card["id"] == "osm_node_1" and card["name"] == "Тестовое кафе"
    assert card["latitude"] == 51.0901 and card["longitude"] == 71.42
    assert card["opening_hours"] is None and card["source"] == "OpenStreetMap"
    assert card["status_note"] == "Часы работы не подтверждены"
    assert card["generated_by"] == "gemini"


@pytest.mark.parametrize("failure", [TimeoutError, RuntimeError])
def test_ai_failure_does_not_turn_valid_poi_into_error_response(application, failure, caplog):
    class Unavailable:
        def generate(self, request, candidates):
            raise failure("private-key precise-location")

    application.state.gemini = Unavailable()
    with TestClient(application) as client:
        populate(application.state.database)
        response = client.post("/api/recommendations", json=request_body())
    assert response.status_code == 200
    cards = response.json()["recommendations"]
    assert len(cards) == 2
    assert {card["category"] for card in cards} == {"cafe", "park"}
    assert "private-key" not in caplog.text + response.text


def test_hallucinated_model_id_is_not_returned(application):
    class Hallucination:
        def generate(self, request, candidates):
            return {
                "recommendations": [
                    {
                        "id": "invented_place",
                        "reason": "invented explanation",
                        "suggested_action": "invented action",
                    }
                ]
            }

    application.state.gemini = Hallucination()
    with TestClient(application) as client:
        populate(application.state.database)
        response = client.post("/api/recommendations", json=request_body())
    assert response.status_code == 200
    cards = response.json()["recommendations"]
    assert len(cards) == 2
    assert {card["category"] for card in cards} == {"cafe", "park"}
    assert "invented" not in response.text
