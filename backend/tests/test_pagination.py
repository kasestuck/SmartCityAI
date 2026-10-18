"""Public pagination and local category illustration contract."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.database.models import POI
from backend.main import create_app


@pytest.fixture
def app(tmp_path):
    return create_app(
        Settings(_env_file=None, database_path=tmp_path / "pages.sqlite3", gemini_api_key="")
    )


@pytest.fixture
def client(app):
    with TestClient(app) as client:
        yield client


@pytest.fixture
def payload():
    return dict(
        latitude=51.1,
        longitude=71.4,
        query="кофе рядом",
        duration_minutes=60,
        transport="walking",
        categories=["cafe"],
    )


def seed(app, count=7, *, category="cafe", name="Кофейня", tags=None):
    places = [
        POI(
            id=f"osm_node_{i}",
            osm_type="node",
            osm_id=i,
            name=f"{name} {i}" if count > 1 else name,
            latitude=51.1 + i * 0.00001,
            longitude=71.4,
            category=category,
            description=None,
            opening_hours=None,
            source="OpenStreetMap",
            collected_at="2026-10-18",
            tags_json=json.dumps(tags or {}, ensure_ascii=False),
        )
        for i in range(1, count + 1)
    ]
    app.state.database.upsert_pois(places)
    return [poi.id for poi in places]


def test_pages_append_without_repeats_until_all_matches_exhausted(client, app, payload):
    expected = seed(app, 16)  # Includes candidates beyond the 12-place Gemini shortlist.
    shown = []
    page_sizes = []
    for _ in range(6):
        response = client.post("/api/recommendations", json={**payload, "exclude_ids": shown})
        assert response.status_code == 200
        body = response.json()
        ids = [card["id"] for card in body["recommendations"]]
        assert not set(ids) & set(shown)
        shown.extend(ids)
        page_sizes.append(len(ids))
        assert body["has_more"] is (len(shown) < len(expected))
    assert shown == expected
    assert page_sizes == [3, 3, 3, 3, 3, 1]
    exhausted = client.post("/api/recommendations", json={**payload, "exclude_ids": shown}).json()
    assert exhausted["recommendations"] == []
    assert exhausted["has_more"] is False


def test_all_excluded_never_calls_generator(client, app, payload):
    ids = seed(app)

    class MustNotGenerate:
        def generate(self, *_):
            pytest.fail("An exhausted search must not call Gemini")

    app.state.gemini = MustNotGenerate()
    response = client.post("/api/recommendations", json={**payload, "exclude_ids": ids})
    assert response.status_code == 200
    assert response.json()["recommendations"] == []
    assert response.json()["has_more"] is False


def test_exclusions_apply_before_shortlist_and_gemini_whitelist(client, app, payload):
    ids = seed(app, 16)
    excluded = ids[:13]

    class Selection:
        def generate(self, request, candidates):
            assert {candidate.poi.id for candidate in candidates} == set(ids[13:])
            return {
                "recommendations": [
                    {"id": ids[0], "reason": "Старое место", "suggested_action": "Осмотреть"},
                    {"id": ids[-1], "reason": "Короткий отдых", "suggested_action": "Заглянуть"},
                ]
            }

    app.state.gemini = Selection()
    body = client.post("/api/recommendations", json={**payload, "exclude_ids": excluded}).json()
    cards = body["recommendations"]
    assert [card["id"] for card in cards] == [ids[-1], ids[13], ids[14]]
    assert cards[0]["generated_by"] == "gemini"
    assert body["has_more"] is False


def test_short_budget_fallback_can_page_and_exhaust(client, app, payload):
    expected = seed(app, 3)
    payload["duration_minutes"] = 15
    shown = []
    for i in range(3):
        body = client.post("/api/recommendations", json={**payload, "exclude_ids": shown}).json()
        assert len(body["recommendations"]) == 1
        card = body["recommendations"][0]
        assert card["budget_warning"]
        shown.append(card["id"])
        assert body["has_more"] is (i < 2)
    assert shown == expected


def test_absent_empty_duplicate_and_unknown_exclusions_are_compatible(client, app, payload):
    ids = seed(app, 3)
    plain = client.post("/api/recommendations", json=payload).json()
    empty = client.post("/api/recommendations", json={**payload, "exclude_ids": []}).json()
    assert plain == empty
    assert plain["has_more"] is False
    body = client.post(
        "/api/recommendations",
        json={**payload, "exclude_ids": [ids[0], ids[0], "unknown' OR 1=1 --"]},
    ).json()
    assert [card["id"] for card in body["recommendations"]] == ids[1:]
    assert body["has_more"] is False


@pytest.mark.parametrize(
    "value", [None, "osm_node_1", [1], [True], [""], [" "], ["x" * 129], ["x"] * 10001]
)
def test_invalid_exclusions_use_existing_validation_envelope(client, payload, value):
    response = client.post("/api/recommendations", json={**payload, "exclude_ids": value})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize(
    "category,icon",
    [
        ("cafe", "lc-coffee.svg"),
        ("restaurant", "lc-utensils.svg"),
        ("park", "lc-trees.svg"),
        ("museum", "lc-landmark.svg"),
        ("attraction", "lc-camera.svg"),
        ("viewpoint", "lc-binoculars.svg"),
        ("playground", "lc-baby.svg"),
    ],
)
def test_card_image_is_existing_local_category_svg(client, app, payload, category, icon):
    seed(app, 1, category=category)
    body = client.post("/api/recommendations", json={**payload, "categories": [category]}).json()
    url = body["recommendations"][0]["image_url"]
    assert url == f"/assets/icons/{icon}"
    asset = Path(__file__).resolve().parents[2] / url.lstrip("/")
    assert asset.is_file()
    assert "<svg" in asset.read_text(encoding="utf-8")


@pytest.mark.parametrize(
    "name,tags",
    [
        ("Т34-85", {"name": "Т34-85", "historic": "tank"}),
        ("osm_node_12345", {"ref": "osm_node_12345"}),
        ("12345", {"ref": "12345"}),
    ],
)
def test_legacy_technical_names_never_reach_api_or_gemini(client, app, payload, name, tags):
    seed(app, 1, name=name, tags=tags)

    calls = []

    class MustNotGenerate:
        def generate(self, *_):
            calls.append(True)
            return {"recommendations": []}

    app.state.gemini = MustNotGenerate()
    body = client.post("/api/recommendations", json=payload).json()
    assert body["recommendations"] == []
    assert body["has_more"] is False
    assert calls == []
