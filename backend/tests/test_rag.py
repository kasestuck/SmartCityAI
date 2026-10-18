import io
import json
from http.client import IncompleteRead

import pytest
from pydantic import SecretStr

from backend.config import Settings
from backend.database.models import POI
from backend.schemas import RecommendationRequest
from backend.services.gemini import GeminiClient
from backend.services.rag import build_recommendations


@pytest.fixture
def recommendation_request():
    return RecommendationRequest(
        latitude=51.1,
        longitude=71.4,
        query="Кофе с розетками для работы",
        duration_minutes=90,
        transport="walking",
    )


@pytest.fixture
def candidates():
    from backend.services.geo_search import Candidate

    return [
        Candidate(
            poi=POI(
                id=f"osm_node_{i}",
                osm_type="node",
                osm_id=i,
                name=f"Место {i}",
                latitude=51.11,
                longitude=71.41,
                category=category,
                description=None,
                opening_hours=None,
                source="OpenStreetMap",
                collected_at="2026-10-17",
                tags_json="{}",
            ),
            distance_meters=100.5 * i,
            estimated_duration_minutes=30,
            score=1 / i,
        )
        for i, category in enumerate(["cafe", "park", "museum", "restaurant"], 1)
    ]


def generator(result=None, *, body=None, error=None):
    settings = Settings(_env_file=None).model_copy(
        update={
            "gemini_api_key": SecretStr("test-secret"),
            "gemini_model": "gemini-3.8-flash",
            "gemini_timeout_seconds": 2.5,
        }
    )

    def transport(*args, **kwargs):
        if error:
            raise error
        if body is not None:
            return io.BytesIO(body)
        return io.BytesIO(
            json.dumps(
                {
                    "candidates": [
                        {
                            "finishReason": "STOP",
                            "content": {"parts": [{"text": json.dumps(result)}]},
                        }
                    ]
                }
            ).encode()
        )

    return GeminiClient(settings, transport=transport)


def item(id, **overrides):
    return {
        "id": id,
        "reason": "Подходит для короткого отдыха",
        "suggested_action": "Заглянуть по пути",
        **overrides,
    }


def test_model_selects_order_but_response_facts_come_from_candidates(
    recommendation_request, candidates
):
    result = build_recommendations(
        recommendation_request,
        candidates,
        generator(
            {
                "recommendations": [
                    item("osm_node_3"),
                    item("osm_node_1"),
                    item("osm_node_2"),
                    item("osm_node_4"),
                ]
            }
        ),
    )
    assert [card.id for card in result.recommendations] == [
        "osm_node_3",
        "osm_node_1",
        "osm_node_2",
    ]
    card = result.recommendations[0]
    assert card.model_dump() == {
        "id": "osm_node_3",
        "name": "Место 3",
        "latitude": 51.11,
        "longitude": 71.41,
        "category": "museum",
        "description": None,
        "reason": "Подходит для короткого отдыха",
        "distance_meters": 301.5,
        "estimated_duration_minutes": 30,
        "suggested_action": "Заглянуть по пути",
        "opening_hours": None,
        "source": "OpenStreetMap",
        "status_note": "Часы работы не подтверждены",
        "generated_by": "gemini",
        "is_open_now": None,
        "budget_warning": None,
        "wheelchair": None,
        "accessibility": None,
        "phone": None,
        "website": None,
        "wikidata": None,
    }


def test_invalid_items_do_not_discard_valid_items_and_partial_fills_without_duplicates(
    recommendation_request, candidates
):
    result = build_recommendations(
        recommendation_request,
        candidates,
        generator(
            {
                "recommendations": [
                    item("invented"),
                    item("osm_node_3"),
                    item("osm_node_3", reason="duplicate"),
                    None,
                    12,
                    {"id": "osm_node_2"},
                    item("osm_node_2", name="Invented name"),
                    item(["osm_node_2"]),
                    item("osm_node_2", reason=" "),
                ]
            }
        ),
    )
    cards = result.recommendations
    assert [card.id for card in cards] == ["osm_node_3", "osm_node_1", "osm_node_2"]
    assert cards[0].reason == "Подходит для короткого отдыха"
    assert "100" in cards[1].reason
    assert "30" in cards[1].reason


@pytest.mark.parametrize(
    "raw",
    [
        None,
        [],
        "broken",
        {},
        {"recommendations": None},
        {"recommendations": []},
        {"recommendations": [], "extra": "bad"},
    ],
)
def test_wrong_envelope_or_empty_model_uses_fallback(recommendation_request, candidates, raw):
    result = build_recommendations(recommendation_request, candidates, generator(raw))
    assert [card.id for card in result.recommendations] == [
        "osm_node_1",
        "osm_node_2",
        "osm_node_3",
    ]
    assert all(card.reason and card.suggested_action for card in result.recommendations)


@pytest.mark.parametrize("failure", ["missing-key", "timeout", "malformed-json"])
def test_gemini_failure_uses_real_candidates_and_does_not_log(
    recommendation_request, candidates, failure, caplog
):
    client = {
        "missing-key": None,
        "timeout": generator(error=TimeoutError("test-secret private query")),
        "malformed-json": generator(body=b"{"),
    }[failure]
    result = build_recommendations(recommendation_request, candidates, client)
    assert len(result.recommendations) == 3
    assert result.recommendations[0].id == "osm_node_1"
    assert "test-secret" not in caplog.text
    assert recommendation_request.query not in caplog.text


def test_empty_shortlist_skips_model(recommendation_request):
    class MustNotGenerate:
        def generate(self, *args):
            pytest.fail("empty shortlist must not call Gemini")

    assert build_recommendations(recommendation_request, [], MustNotGenerate()).model_dump() == {
        "recommendations": [],
        "language": "ru",
        "query_context": {
            "latitude": 51.1,
            "longitude": 71.4,
            "categories": [],
            "duration_minutes": 90,
            "transport": "walking",
        },
    }


def test_injected_generator_runtime_failure_uses_templates(recommendation_request, candidates):
    class UnavailableGenerator:
        def generate(self, *args):
            raise RuntimeError("private upstream details")

    cards = build_recommendations(
        recommendation_request, candidates, UnavailableGenerator()
    ).recommendations
    assert [card.id for card in cards] == ["osm_node_1", "osm_node_2", "osm_node_3"]
    assert "private" not in cards[0].reason


def test_truncated_http_read_keeps_api_response_successful(
    recommendation_request, candidates, tmp_path, caplog
):
    from fastapi.testclient import TestClient

    from backend.main import create_app

    class TruncatedResponse(io.BytesIO):
        def read(self, size=-1):
            raise IncompleteRead(b"test-secret private upstream response", 64)

    settings = Settings(
        _env_file=None,
        database_path=tmp_path / "poi.sqlite3",
        gemini_api_key=SecretStr("test-secret"),
    )
    app = create_app(settings)
    app.state.gemini = GeminiClient(settings, transport=lambda *args, **kwargs: TruncatedResponse())
    with TestClient(app, raise_server_exceptions=False) as client:
        app.state.database.upsert_pois(candidate.poi for candidate in candidates)
        response = client.post("/api/recommendations", json=recommendation_request.model_dump())

    assert response.status_code == 200
    cards = response.json()["recommendations"]
    assert len(cards) == 3
    assert {card["id"] for card in cards} <= {
        "osm_node_1",
        "osm_node_2",
        "osm_node_3",
        "osm_node_4",
    }
    assert all("не подтвержден" in card["reason"] for card in cards)
    assert "test-secret" not in caplog.text
    assert "private upstream response" not in caplog.text


@pytest.mark.parametrize(
    "unsafe",
    [
        "Открыто сейчас",
        "It is open now",
        "Работает круглосуточно",
        "Есть розетки и бесплатный Wi-Fi",
        "Здесь безопасно для детей",
        "Сегодня проходит выставка",
        "a" * 1001,
    ],
)
def test_obvious_unverified_claims_are_replaced_with_templates(
    recommendation_request, candidates, unsafe
):
    result = build_recommendations(
        recommendation_request,
        candidates[:1],
        generator(
            {
                "recommendations": [
                    item("osm_node_1", reason=unsafe),
                ]
            }
        ),
    )
    assert result.recommendations[0].reason != unsafe
    assert "не подтвержден" in result.recommendations[0].reason


@pytest.mark.parametrize(
    "category,action",
    [
        ("cafe", "Рассмотреть кафе для короткого отдыха; перед визитом уточнить часы и условия."),
        ("park", "Запланировать короткую прогулку; условия на месте заранее не проверены."),
        ("museum", "Рассмотреть посещение музея; заранее уточнить часы, билеты и условия."),
        ("other", "Рассмотреть посещение места; заранее уточнить часы и условия."),
    ],
)
def test_fallback_actions_are_category_appropriate(
    recommendation_request, candidates, category, action
):
    from dataclasses import replace

    candidate = replace(candidates[0], poi=replace(candidates[0].poi, category=category))
    cards = build_recommendations(recommendation_request, [candidate]).recommendations
    assert cards[0].suggested_action == action
    assert cards[0].opening_hours is None


@pytest.mark.parametrize(
    "unsafe_reason",
    [
        "Место работает сейчас",
        "Кафе сейчас работает",
        "Сейчас закрыто",
        "It is open today",
        "Қазір ашық",
        "Қазір жабық",
    ],
)
def test_missing_hours_rejects_current_status_claim_and_explains_uncertainty(
    recommendation_request, candidates, unsafe_reason
):
    result = build_recommendations(
        recommendation_request,
        candidates[:1],
        generator({"recommendations": [item("osm_node_1", reason=unsafe_reason)]}),
    )
    card = result.recommendations[0]
    assert card.reason != unsafe_reason
    assert card.generated_by == "fallback_template"
    assert card.status_note == "Часы работы не подтверждены"


def test_generated_text_and_fallback_have_distinct_provenance(recommendation_request, candidates):
    result = build_recommendations(
        recommendation_request,
        candidates[:2],
        generator({"recommendations": [item("osm_node_1")]}),
    )
    first, second = result.recommendations
    assert first.generated_by == "gemini"
    assert first.reason == "Подходит для короткого отдыха"
    assert second.generated_by == "fallback_template"
    assert first.source == second.source == "OpenStreetMap"
    assert first.estimated_duration_minutes == second.estimated_duration_minutes == 30


@pytest.mark.parametrize(
    ("language", "warning"),
    [("ru", "Превышает ваш бюджет на 15 минут"), ("kk", "Уақыт бюджетіңізден 15 минутқа асады")],
)
def test_budget_warning_is_present_even_with_accepted_ai_text(
    recommendation_request, candidates, language, warning
):
    request = recommendation_request.model_copy(
        update={"duration_minutes": 15, "language": language}
    )
    result = build_recommendations(
        request,
        candidates[:1],
        generator({"recommendations": [item("osm_node_1")]}),
    )
    card = result.recommendations[0]
    assert card.generated_by == "gemini"
    assert card.budget_warning == warning
    assert card.estimated_duration_minutes == 30
