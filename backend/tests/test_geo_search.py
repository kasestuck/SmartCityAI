import math
from dataclasses import FrozenInstanceError

import pytest

from backend.database.db import Database
from backend.schemas import RecommendationRequest


def test_haversine_uses_meters_and_handles_dateline_and_antipodes():
    from backend.services.geo_search import haversine_meters

    assert haversine_meters(0, 0, 0, 0) == 0
    assert haversine_meters(0, 0, 0, 1) == pytest.approx(111_195, abs=1)
    assert haversine_meters(0, 179.99, 0, -179.99) == pytest.approx(2223.9, abs=1)
    assert haversine_meters(90, 0, 90, 180) == pytest.approx(0, abs=0.000001)
    assert haversine_meters(0, 0, 0, 180) == pytest.approx(20_015_114, abs=2)


@pytest.fixture
def database(tmp_path):
    database = Database(tmp_path / "geo.sqlite3")
    database.initialize()
    return database


def insert(database, osm_id=1, **overrides):
    values = {
        "id": f"osm_node_{osm_id}",
        "osm_type": "node",
        "osm_id": osm_id,
        "name": "Место",
        "latitude": 0.0,
        "longitude": 0.0,
        "category": "park",
        "description": None,
        "opening_hours": None,
        "source": "OpenStreetMap",
        "collected_at": "2026-10-17T00:00:00Z",
        "tags_json": "{}",
    }
    values.update(overrides)
    with database.connection() as connection:
        connection.execute(
            f"INSERT INTO poi ({', '.join(values)}) VALUES ({', '.join('?' for _ in values)})",
            tuple(values.values()),
        )


def request(**overrides):
    values = {
        "latitude": 0.0,
        "longitude": 0.0,
        "query": "рядом",
        "duration_minutes": 60,
        "transport": "walking",
    }
    values.update(overrides)
    return RecommendationRequest(**values)


def search(database, **overrides):
    from backend.services.geo_search import search_poi

    return search_poi(database, request(**overrides))


@pytest.mark.parametrize(
    "coordinates", [(math.nan, 0, 0, 0), (0, math.inf, 0, 0), (0, 0, -91, 0), (0, 0, 0, 181)]
)
def test_haversine_rejects_invalid_coordinates(coordinates):
    from backend.services.geo_search import haversine_meters

    with pytest.raises(ValueError):
        haversine_meters(*coordinates)


def test_empty_database_returns_no_candidates(database):
    assert search(database) == []


def test_categories_are_hard_or_filter_and_unknown_categories_have_no_matches(database):
    insert(database, 1, category="cafe")
    insert(database, 2, category="park")
    insert(database, 3, category="museum")
    assert {item.poi.category for item in search(database, categories=["cafe", "park"])} == {
        "cafe",
        "park",
    }
    assert len(search(database, categories=[])) == 3
    assert search(database, categories=["unknown"]) == []
    assert search(database, categories=["cafe') OR 1=1 --"]) == []
    assert [
        item.poi.category
        for item in search(
            database,
            categories=["cafe", "unknown"],
            query="Хочу прогулку",
        )
    ] == ["cafe"]


@pytest.mark.parametrize(
    "category,visit",
    [
        ("cafe", 20),
        ("restaurant", 45),
        ("park", 20),
        ("museum", 45),
        ("attraction", 20),
        ("viewpoint", 10),
        ("playground", 20),
    ],
)
def test_visit_time_is_category_specific(database, category, visit):
    insert(database, category=category)
    results = search(database)
    assert results[0].estimated_duration_minutes == visit
    assert bool(search(database, duration_minutes=max(15, visit - 1))) == (visit <= 15)


def test_walking_time_is_one_way_ceiling_and_filters_at_budget_boundary(database):
    insert(database, longitude=0.001, category="cafe")
    assert search(database, duration_minutes=21) == []
    result = search(database, duration_minutes=22)[0]
    assert result.distance_meters == pytest.approx(111.195, abs=0.001)
    assert result.estimated_duration_minutes == 22
    with pytest.raises(FrozenInstanceError):
        result.score = 0


def test_radius_uses_haversine_after_sql_box_filter(database):
    insert(database, 1, latitude=0.1, longitude=0, category="viewpoint")
    insert(database, 2, latitude=0.1, longitude=0.1, category="viewpoint")
    insert(database, 3, latitude=20, longitude=20, category="viewpoint")
    assert [item.poi.id for item in search(database, duration_minutes=240)] == ["osm_node_1"]


@pytest.mark.parametrize(
    "latitude,longitude,poi_latitude,poi_longitude",
    [
        (0, 179.99, 0, -179.99),
        (0, -179.99, 0, 179.99),
        (89.95, 0, 89.95, 180),
        (-89.95, 0, -89.95, -180),
        (90, 15, 90, -160),
        (-90, -15, -90, 160),
    ],
)
def test_bounding_box_preserves_dateline_and_polar_candidates(
    database,
    latitude,
    longitude,
    poi_latitude,
    poi_longitude,
):
    insert(database, latitude=poi_latitude, longitude=poi_longitude, category="viewpoint")
    result = search(database, latitude=latitude, longitude=longitude, duration_minutes=240)
    assert len(result) == 1
    assert math.isfinite(result[0].distance_meters)


@pytest.mark.parametrize(
    "query,preferred",
    [
        ("Хочу кофе", "cafe"),
        ("coffee nearby", "cafe"),
        ("Хочу короткую прогулку", "park"),
        ("walk", "park"),
        ("Я с ребёнком", "playground"),
        ("family with kids", "playground"),
        ("Я турист", "museum"),
        ("tourist", "museum"),
    ],
)
def test_russian_and_english_intents_rank_relevant_categories(database, query, preferred):
    insert(database, 1, category="restaurant")
    insert(database, 2, category=preferred, longitude=0.001)
    assert search(database, query=query)[0].poi.category == preferred


def test_mixed_intents_give_both_categories_equal_relevance(database):
    insert(database, 1, category="restaurant")
    insert(database, 2, category="cafe")
    insert(database, 3, category="park")
    assert [item.poi.category for item in search(database, query="кофе и прогулка")][:2] == [
        "cafe",
        "park",
    ]


@pytest.mark.parametrize(
    "matching_field,matching_value",
    [
        ("name", "lotus"),
        ("description", "lotus garden"),
        ("tags_json", '{"name:en": "lotus"}'),
    ],
)
def test_text_matches_name_description_and_tag_values(database, matching_field, matching_value):
    insert(database, 1)
    insert(database, 2, **{matching_field: matching_value})
    assert search(database, query="lotus")[0].poi.id == "osm_node_2"


def test_tag_metadata_keys_are_not_searchable_place_facts(database):
    insert(database, 1, tags_json='{"name": "Место", "source": "survey"}')
    insert(database, 2, name="source")
    results = search(database, query="source")
    assert results[0].poi.id == "osm_node_2"
    assert results[0].score > results[1].score


def test_scoring_uses_normalized_weights_and_keeps_unmatched_nearby_places(database):
    insert(database, 1, category="cafe", name="coffee")
    insert(database, 2, category="park", name="coffee")
    results = search(database, query="coffee")
    assert [item.score for item in results] == pytest.approx([1.0, 0.5])
    assert len(search(database, query="неизвестное слово")) == 2
    assert all(0 <= item.score <= 1 for item in results)


def test_results_are_limited_and_ties_use_distance_then_stable_id(database):
    from backend.services.geo_search import search_poi

    for number in range(20, 0, -1):
        insert(database, number)
    insert(database, 21, longitude=0.001)
    ids = [item.poi.id for item in search(database)]
    assert len(ids) == 12
    assert ids == sorted(f"osm_node_{number}" for number in range(1, 21))[:12]
    assert len(search_poi(database, request(), limit=3)) == 3
    assert len(search_poi(database, request(), limit=100)) == 12
    assert search_poi(database, request(), limit=0) == []


def test_generic_query_orders_by_distance(database):
    insert(database, 1, longitude=0.002)
    insert(database, 2, longitude=0.001)
    assert [item.poi.id for item in search(database)] == ["osm_node_2", "osm_node_1"]


@pytest.mark.parametrize("longitude,poi_longitude", [(180, 180), (180, -180), (-180, 180)])
def test_exact_visit_budget_includes_same_place_at_both_dateline_endpoints(
    database,
    longitude,
    poi_longitude,
):
    insert(database, longitude=poi_longitude, category="cafe")
    result = search(database, longitude=longitude, duration_minutes=20, categories=["cafe"])
    assert len(result) == 1
    assert result[0].distance_meters == 0
    assert result[0].estimated_duration_minutes == 20
