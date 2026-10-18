"""Endpoint integration uses an actual temporary SQLite and fake external AI."""

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
        "categories": [],
        "duration_minutes": 60,
        "transport": "walking",
    }
    cards = response.json()["recommendations"]
    assert len(cards) == 3
    assert len({card["id"] for card in cards}) == 3
    assert all(
        card["id"] in {"osm_node_1", "osm_node_2", "osm_node_3", "osm_node_4"} for card in cards
    )
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
        assert client.post("/api/recommendations", json=body).json()["recommendations"] == []


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
    assert len(response.json()["recommendations"]) == 3
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
    assert len(response.json()["recommendations"]) == 3
    assert "invented" not in response.text
