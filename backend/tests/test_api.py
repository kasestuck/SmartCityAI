import json

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.main import create_app


@pytest.fixture
def application(tmp_path):
    return create_app(
        Settings(
            _env_file=None,
            database_path=tmp_path / "poi.sqlite3",
            cors_origins=["http://localhost:5173"],
            gemini_api_key="",
        )
    )


@pytest.fixture
def client(application):
    with TestClient(application, raise_server_exceptions=False) as test_client:
        yield test_client


@pytest.fixture
def payload():
    return {
        "latitude": 51.09,
        "longitude": 71.42,
        "query": "Хочу кофе и прогулку",
        "duration_minutes": 60,
        "transport": "walking",
    }


def assert_validation_error(response):
    assert response.status_code == 422
    assert response.json() == {
        "error": {
            "code": "VALIDATION_ERROR",
            "message": "Некорректные параметры запроса",
        }
    }


def test_health_checks_initialized_database(client, application):
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.get("/api/health").status_code == 200
    with application.state.database.connection(readonly=True) as connection:
        assert connection.execute("SELECT COUNT(*) FROM poi").fetchone()[0] == 0


@pytest.mark.parametrize("categories", [None, [], ["cafe", "park"], ["unknown"]])
def test_recommendations_return_empty_list_on_empty_database(client, payload, categories):
    if categories is not None:
        payload["categories"] = categories
    response = client.post("/api/recommendations", json=payload)
    assert response.status_code == 200
    assert response.json() == {"recommendations": []}


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("latitude", -90.01),
        ("latitude", 90.01),
        ("longitude", -180.01),
        ("longitude", 180.01),
        ("latitude", True),
        ("longitude", False),
        ("latitude", "51.09"),
        ("longitude", None),
        ("duration_minutes", 14),
        ("duration_minutes", 241),
        ("duration_minutes", 60.5),
        ("duration_minutes", 60.0),
        ("duration_minutes", True),
        ("duration_minutes", "60"),
        ("query", ""),
        ("query", " \t\n "),
        ("query", "а" * 501),
        ("query", 12),
        ("transport", "driving"),
        ("transport", None),
        ("categories", "cafe"),
        ("categories", [42]),
        ("categories", None),
        ("unexpected", "value"),
    ],
)
def test_invalid_parameters_have_safe_contract_error(client, payload, field, value):
    payload[field] = value
    assert_validation_error(client.post("/api/recommendations", json=payload))


@pytest.mark.parametrize(
    "field", ["latitude", "longitude", "query", "duration_minutes", "transport"]
)
def test_missing_required_fields_are_rejected(client, payload, field):
    del payload[field]
    assert_validation_error(client.post("/api/recommendations", json=payload))


@pytest.mark.parametrize(
    ("latitude", "longitude", "duration"), [(-90, -180, 15), (90, 180, 240), (0, 0, 60)]
)
def test_inclusive_numeric_boundaries_are_accepted(client, payload, latitude, longitude, duration):
    payload.update(latitude=latitude, longitude=longitude, duration_minutes=duration)
    assert client.post("/api/recommendations", json=payload).status_code == 200


@pytest.mark.parametrize("query", ["  кофе  ", "а" * 500, "  " + "а" * 500 + "  "])
def test_query_is_trimmed_before_length_validation(client, payload, query):
    payload["query"] = query
    assert client.post("/api/recommendations", json=payload).status_code == 200


@pytest.mark.parametrize("number", ["NaN", "Infinity", "-Infinity"])
def test_nonfinite_json_numbers_are_safe_validation_errors(client, payload, number):
    body = json.dumps(payload).replace("51.09", number)
    response = client.post(
        "/api/recommendations", content=body, headers={"Content-Type": "application/json"}
    )
    assert_validation_error(response)


@pytest.mark.parametrize("body", ["{", "[]", "null", '"coffee"', ""])
def test_malformed_or_wrong_shape_json_is_rejected(client, body):
    response = client.post(
        "/api/recommendations", content=body, headers={"Content-Type": "application/json"}
    )
    assert_validation_error(response)


def test_health_detects_removed_database_without_recreating_it(client, application):
    path = application.state.settings.database_path
    path.unlink()
    response = client.get("/api/health")
    assert response.status_code == 500
    assert response.json() == {
        "error": {"code": "INTERNAL_ERROR", "message": "Внутренняя ошибка сервера"}
    }
    assert not path.exists()


def test_missing_poi_table_is_reported_as_internal_error(client, application, payload):
    with application.state.database.connection() as connection:
        connection.execute("DROP TABLE poi")
    assert client.get("/api/health").status_code == 500
    response = client.post("/api/recommendations", json=payload)
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"


def test_unexpected_exception_has_safe_json_and_cors(application, caplog):
    @application.get("/api/test-failure")
    def fail():
        raise RuntimeError("secret: query=51.09,71.42")

    with TestClient(application, raise_server_exceptions=False) as client:
        response = client.get("/api/test-failure", headers={"Origin": "http://localhost:5173"})
    assert response.status_code == 500
    assert response.json() == {
        "error": {"code": "INTERNAL_ERROR", "message": "Внутренняя ошибка сервера"}
    }
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "secret" not in caplog.text
    assert "51.09" not in caplog.text


def test_validation_failure_does_not_log_request_body(client, payload, caplog):
    payload.update(latitude=999, query="private user query")
    assert_validation_error(client.post("/api/recommendations", json=payload))
    assert "private user query" not in caplog.text


def test_cors_preflight_allows_configured_origin(client):
    response = client.options(
        "/api/recommendations",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_cors_does_not_authorize_unknown_origin(client):
    response = client.get("/api/health", headers={"Origin": "https://unknown.example"})
    assert "access-control-allow-origin" not in response.headers


def test_validation_error_has_cors_headers(client, payload):
    payload["latitude"] = 999
    response = client.post(
        "/api/recommendations", json=payload, headers={"Origin": "http://localhost:5173"}
    )
    assert_validation_error(response)
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


@pytest.mark.parametrize(
    ("method", "path", "status", "code"),
    [
        ("get", "/api/absent", 404, "NOT_FOUND"),
        ("get", "/api/recommendations", 405, "METHOD_NOT_ALLOWED"),
    ],
)
def test_http_errors_use_json_envelope(client, method, path, status, code):
    response = getattr(client, method)(path)
    assert response.status_code == status
    assert response.json()["error"]["code"] == code
    if status == 405:
        assert "POST" in response.headers["allow"]


@pytest.mark.parametrize("status,code", [(429, "RATE_LIMITED"), (503, "AI_UNAVAILABLE")])
def test_reserved_http_errors_use_contract_codes(application, status, code):
    @application.get("/api/test-error")
    def error():
        raise HTTPException(status_code=status, detail="sensitive", headers={"Retry-After": "3"})

    with TestClient(application) as client:
        response = client.get("/api/test-error")
    assert response.status_code == status
    assert response.json()["error"]["code"] == code
    assert "sensitive" not in response.text
    assert response.headers["retry-after"] == "3"


def test_openapi_describes_contract_and_docs_are_accessible(client):
    schema = client.get("/openapi.json").json()
    assert "/api/health" in schema["paths"]
    assert "/api/recommendations" in schema["paths"]
    response = schema["paths"]["/api/recommendations"]["post"]["responses"]["422"]
    assert response["content"]["application/json"]["schema"]["$ref"].endswith("/ErrorResponse")
    assert client.get("/docs").status_code == 200
