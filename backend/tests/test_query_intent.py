"""Query intent regression tests through real FastAPI, SQLite and UTF-8 JSON.

Fixtures and language cases are independent of the production intent dictionary.
Only the external Gemini HTTP transport is replaced in its boundary test.
"""

import io
import json

import pytest
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.database.models import POI
from backend.main import create_app
from backend.routes import recommendations as recommendations_route
from backend.services.gemini import GeminiClient

# Literal, independently specified 7-category x 3-query-language acceptance matrix.
CATEGORY_CASES = [
    ("ru", "museum", "Хочу посетить музей"),
    ("kk", "museum", "Мұражайға барғым келеді"),
    ("en", "museum", "I want to visit a museum"),
    ("ru", "cafe", "Хочу зайти в кафе"),
    ("kk", "cafe", "Кофеханаға барғым келеді"),
    ("en", "cafe", "I want to visit a coffee shop"),
    ("ru", "restaurant", "Хочу посетить ресторан"),
    ("kk", "restaurant", "Мейрамханаға барғым келеді"),
    ("en", "restaurant", "I want to visit a restaurant"),
    ("ru", "park", "Хочу пойти в парк"),
    ("kk", "park", "Саябаққа барғым келеді"),
    ("en", "park", "I want to visit a park"),
    ("ru", "attraction", "Хочу увидеть достопримечательность"),
    ("kk", "attraction", "Көрікті жерге барғым келеді"),
    ("en", "attraction", "I want to visit a landmark"),
    ("ru", "viewpoint", "Хочу на смотровую площадку"),
    ("kk", "viewpoint", "Шолу алаңына барғым келеді"),
    ("en", "viewpoint", "I want to visit a viewpoint"),
    ("ru", "playground", "Хочу найти детскую площадку"),
    ("kk", "playground", "Ойын алаңына барғым келеді"),
    ("en", "playground", "I want to visit a playground"),
]

NATURAL_CASES = [
    ("ru", "museum", "где тут можно посмотреть что-то интересное из истории"),
    ("ru", "restaurant", "Хочу пообедать"),
    ("ru", "playground", "Где детям покататься на качелях?"),
    ("ru", "viewpoint", "Хочу полюбоваться городом с высоты"),
    ("en", "cafe", "I have an hour, want coffee somewhere quiet"),
    ("en", "museum", "Somewhere to learn about local history"),
    ("en", "playground", "Where can the kids use swings and slides?"),
    ("en", "restaurant", "I would like dinner nearby"),
    ("kk", "museum", "Қала тарихымен танысқым келеді"),
    ("kk", "cafe", "Тыныш жерде кофе ішкім келеді"),
    ("kk", "park", "Саябағына барғым келеді"),
    ("kk", "playground", "Балалар ойын алаңына барғым келеді"),
]

SYNONYM_CASES = [
    ("ru", "cafe", "Найди кофейню рядом"),
    ("ru", "museum", "ХОЧУ В МУЗЕЙ!"),
    ("kk", "restaurant", "Асханаға барғым келеді"),
    ("kk", "viewpoint", "Панорама көргім келеді"),
    ("kk", "playground", "Балалар алаңын іздеймін"),
    ("en", "cafe", "Is there a café nearby?"),
    ("en", "cafe", "I would like a CAFE nearby"),
    ("en", "attraction", "Find an attraction nearby"),
    ("en", "viewpoint", "Is there a lookout nearby?"),
]


@pytest.fixture
def app(tmp_path):
    return create_app(
        Settings(
            _env_file=None,
            database_path=tmp_path / "query-intent.sqlite3",
            gemini_api_key="",
        )
    )


@pytest.fixture
def client(app):
    with TestClient(app) as test_client:
        yield test_client


def seed(app, counts=None):
    """Many closer distractors can fill all 12 shortlist slots before a museum."""
    counts = (
        counts
        if counts is not None
        else {
            "cafe": 14,
            "attraction": 14,
            "viewpoint": 14,
            "restaurant": 4,
            "park": 4,
            "museum": 4,
            "playground": 4,
        }
    )
    offsets = {
        "cafe": 0.00001,
        "attraction": 0.0002,
        "viewpoint": 0.0004,
        "restaurant": 0.0012,
        "park": 0.0014,
        "playground": 0.0016,
        "museum": 0.002,
    }
    places = []
    for category, count in counts.items():
        for index in range(count):
            number = len(places) + 1
            places.append(
                POI(
                    id=f"osm_node_{number}",
                    osm_type="node",
                    osm_id=number,
                    name=f"Место Альфа {number}",
                    latitude=51.1 + offsets[category] + index * 0.000001,
                    longitude=71.4,
                    category=category,
                    description=None,
                    opening_hours=None,
                    source="OpenStreetMap",
                    collected_at="2026-10-19",
                    tags_json="{}",
                )
            )
    app.state.database.upsert_pois(places)
    return places


@pytest.fixture
def populated(client, app):
    seed(app)
    return client


def post_query(client, query, *, language="ru", **overrides):
    payload = {
        "latitude": 51.1,
        "longitude": 71.4,
        "query": query,
        "duration_minutes": 60,
        "transport": "walking",
        "language": language,
        **overrides,
    }
    response = client.post(
        "/api/recommendations",
        content=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    assert response.status_code == 200, response.text
    return response.json()


def assert_category(body, expected):
    assert body["recommendations"], body
    assert {card["category"] for card in body["recommendations"]} == {expected}, body
    assert body["query_context"]["categories"] == [expected]


def case_id(case):
    return f"{case[0]}-{case[1]}"


@pytest.mark.parametrize(
    "language,category,query",
    CATEGORY_CASES,
    ids=[case_id(case) for case in CATEGORY_CASES],
)
def test_category_matrix_without_explicit_filter(populated, language, category, query):
    # English input is independent of the existing ru/kk explanation language field.
    body = post_query(populated, query, language="kk" if language == "kk" else "ru")
    assert_category(body, category)


@pytest.mark.parametrize(
    "language,category,query",
    NATURAL_CASES,
    ids=[case_id(case) for case in NATURAL_CASES],
)
def test_natural_intent_without_explicit_filter(populated, language, category, query):
    body = post_query(populated, query, language="kk" if language == "kk" else "ru")
    assert_category(body, category)


@pytest.mark.parametrize(
    "language,category,query",
    SYNONYM_CASES,
    ids=[case_id(case) for case in SYNONYM_CASES],
)
def test_synonyms_inflections_and_case(populated, language, category, query):
    body = post_query(populated, query, language="kk" if language == "kk" else "ru")
    assert_category(body, category)


def test_explicit_categories_remain_authoritative(populated):
    body = post_query(populated, "I want to visit a museum", categories=["cafe"])
    assert_category(body, "cafe")


def test_missing_intended_category_does_not_substitute_cafes(client, app):
    seed(app, {"cafe": 14, "viewpoint": 14})
    body = post_query(client, "Мұражайға барғым келеді", language="kk")
    assert body["recommendations"] == []
    assert body["has_more"] is False
    assert body["query_context"]["categories"] == ["museum"]


def test_short_museum_budget_uses_matching_overbudget_fallback(populated):
    body = post_query(populated, "I want to visit a museum", duration_minutes=15)
    assert_category(body, "museum")
    assert len(body["recommendations"]) == 1
    assert body["recommendations"][0]["estimated_duration_minutes"] > 15
    assert body["recommendations"][0]["budget_warning"]


def test_pagination_remains_in_inferred_category_until_exhausted(populated, app):
    with app.state.database.connection(readonly=True) as connection:
        expected = {
            row[0] for row in connection.execute("SELECT id FROM poi WHERE category = 'museum'")
        }
    seen = []
    for _ in range(4):
        body = post_query(populated, "I want to visit a museum", exclude_ids=seen)
        cards = body["recommendations"]
        assert {card["category"] for card in cards} <= {"museum"}
        ids = [card["id"] for card in cards]
        assert not set(ids) & set(seen)
        seen.extend(ids)
        assert body["has_more"] is (set(seen) != expected)
        if not body["has_more"]:
            break
    assert set(seen) == expected
    exhausted = post_query(populated, "I want to visit a museum", exclude_ids=seen)
    assert exhausted["recommendations"] == []
    assert exhausted["has_more"] is False


def test_unknown_query_preserves_generic_nearby_search(populated):
    body = post_query(populated, "абракадабра")
    assert body["recommendations"]
    assert body["query_context"]["categories"] == []
    assert body["recommendations"][0]["category"] == "cafe"


def test_multiple_explicit_categories_are_a_union(client, app):
    seed(app, {"museum": 1, "cafe": 1, "viewpoint": 2})
    body = post_query(client, "Панорама", categories=["museum", "cafe"])
    assert {card["category"] for card in body["recommendations"]} == {"museum", "cafe"}
    assert body["query_context"]["categories"] == ["cafe", "museum"]


def test_multiple_textual_intents_are_a_union(client, app):
    seed(app, {"museum": 1, "cafe": 1, "viewpoint": 2})
    body = post_query(client, "I want a museum and coffee")
    assert {card["category"] for card in body["recommendations"]} == {"museum", "cafe"}
    assert body["query_context"]["categories"] == ["cafe", "museum"]


@pytest.mark.parametrize(
    "label,query",
    [
        ("ru", "Хочу посетить музей. Проверка ё: әғқңөұүhіһ"),
        ("kk", "Мұражайға барғым келеді. Әріптер: әғқңөұүhіһ"),
        ("en", "I want to visit a museum. UTF-8 probe: әғқңөұүhіһ"),
    ],
    ids=["ru", "kk", "en"],
)
def test_utf8_query_arrives_unchanged(populated, monkeypatch, label, query):
    received = []
    real_search = recommendations_route.search_poi

    def observe_search(database, request, *args, **kwargs):
        received.append(request.query)
        return real_search(database, request, *args, **kwargs)

    monkeypatch.setattr(recommendations_route, "search_poi", observe_search)
    post_query(populated, query, language="kk" if label == "kk" else "ru")
    assert received
    assert all(value == query for value in received)
    # Artificial test data only: do not add raw query logging to product code.
    print(f"UTF8 {label}: sent={query!r}; received={received[0]!r}; equal=True")


def test_matching_candidates_reach_real_gemini_transport_without_other_category_fill(
    populated, app
):
    captured = []
    query = "I want to visit a museum"

    def transport(http_request, *, timeout):
        envelope = json.loads(http_request.data.decode("utf-8"))
        data = json.loads(envelope["contents"][0]["parts"][0]["text"])
        captured.append(data)
        selection = {
            "recommendations": [
                {
                    "id": data["candidates"][0]["id"],
                    "reason": "A place to explore the collection.",
                    "suggested_action": "Check visiting conditions before leaving.",
                }
            ]
        }
        return io.BytesIO(
            json.dumps(
                {
                    "candidates": [
                        {
                            "finishReason": "STOP",
                            "content": {"parts": [{"text": json.dumps(selection)}]},
                        }
                    ]
                }
            ).encode("utf-8")
        )

    settings = Settings(_env_file=None, gemini_api_key="test-only-not-a-real-key")
    app.state.gemini = GeminiClient(settings, transport=transport)
    body = post_query(populated, query)
    assert len(captured) == 1
    assert captured[0]["query"] == query
    assert captured[0]["categories"] == ["museum"]
    assert captured[0]["candidates"]
    assert {poi["category"] for poi in captured[0]["candidates"]} == {"museum"}
    assert_category(body, "museum")
    assert len(body["recommendations"]) == 3
    assert body["recommendations"][0]["generated_by"] == "gemini"
    assert all(card["generated_by"] == "fallback_template" for card in body["recommendations"][1:])


@pytest.mark.parametrize("query", ["parking nearby", "spark of inspiration", "parkour training"])
def test_english_substrings_are_not_category_filters(populated, query):
    body = post_query(populated, query)
    assert body["recommendations"]
    assert body["query_context"]["categories"] == []


@pytest.mark.parametrize(
    "query",
    ["I am on the lookout for coffee", "I want a cafe\u0301 nearby"],
    ids=["lookout-idiom", "decomposed-unicode"],
)
def test_coffee_intent_survives_idiom_and_unicode_normalization(populated, query):
    assert_category(post_query(populated, query), "cafe")


def test_empty_category_list_also_infers_intent(populated):
    assert_category(post_query(populated, "Мұражай", categories=[]), "museum")


def test_category_noun_keeps_priority_over_contextual_history(populated):
    assert_category(
        post_query(populated, "Looking for a quiet park and its history"),
        "park",
    )


def test_russian_parking_verb_is_not_a_park_category_filter(populated):
    body = post_query(populated, "Где тут парковать машину?")
    assert body["recommendations"]
    assert body["query_context"]["categories"] == []
