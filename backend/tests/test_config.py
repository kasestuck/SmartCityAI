from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.config import Settings

BACKEND_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def isolated_environment(monkeypatch):
    monkeypatch.delenv("DATABASE_PATH", raising=False)
    monkeypatch.delenv("CORS_ORIGINS", raising=False)


def test_defaults_are_independent_of_working_directory(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    settings = Settings(_env_file=None)
    assert settings.database_path == BACKEND_DIR / "data" / "poi.sqlite3"
    assert settings.cors_origins == ["http://localhost:5173"]
    assert Path(Settings.model_config["env_file"]) == BACKEND_DIR / ".env"


def test_relative_database_path_is_relative_to_backend(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_PATH", "custom/places.sqlite3")
    settings = Settings(_env_file=None)
    assert settings.database_path == BACKEND_DIR / "custom" / "places.sqlite3"


def test_dotenv_values_and_process_environment_priority(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text(
        'DATABASE_PATH=dotenv.sqlite3\nCORS_ORIGINS=["http://dotenv.test"]\nUNRELATED=value\n',
        encoding="utf-8",
    )
    settings = Settings(_env_file=env_file)
    assert settings.database_path == BACKEND_DIR / "dotenv.sqlite3"
    assert settings.cors_origins == ["http://dotenv.test"]
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "process.sqlite3"))
    monkeypatch.setenv("CORS_ORIGINS", '["https://frontend.test", "http://localhost:3000"]')
    settings = Settings(_env_file=env_file)
    assert settings.database_path == tmp_path / "process.sqlite3"
    assert settings.cors_origins == ["https://frontend.test", "http://localhost:3000"]


def test_explicit_values_are_normalized():
    settings = Settings(database_path=Path("relative.sqlite3"), _env_file=None)
    assert settings.database_path == BACKEND_DIR / "relative.sqlite3"


def test_cors_origins_must_be_a_list_of_strings():
    with pytest.raises(ValidationError):
        Settings(cors_origins=[123], _env_file=None)


def test_collection_and_ai_defaults_are_safe_and_relative_to_backend():
    settings = Settings(_env_file=None, gemini_api_key="private-test-key")
    assert settings.poi_cache_path == BACKEND_DIR / "cache" / "overpass.json"
    assert settings.overpass_bbox == (50.95, 71.20, 51.30, 71.75)
    assert settings.overpass_attempts == 3
    assert settings.gemini_timeout_seconds == 8
    assert "private-test-key" not in repr(settings)
    assert settings.gemini_api_key.get_secret_value() == "private-test-key"


@pytest.mark.parametrize(
    "options",
    [
        {"overpass_bbox": (52, 71, 51, 72)},
        {"overpass_bbox": (51, 73, 52, 72)},
        {"overpass_bbox": (-91, 71, 52, 72)},
        {"overpass_bbox": (51, 71, 52, float("inf"))},
        {"overpass_bbox": (51, 71, 52)},
        {"overpass_timeout_seconds": 0},
        {"overpass_attempts": 0},
        {"overpass_attempts": 6},
        {"overpass_retry_delay_seconds": -1},
        {"poi_cache_ttl_seconds": -1},
        {"gemini_timeout_seconds": float("nan")},
        {"gemini_timeout_seconds": 0},
        {"gemini_model": "../../unsafe"},
    ],
)
def test_network_settings_reject_invalid_limits(options):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **options)


def test_collection_settings_can_be_loaded_from_dotenv(tmp_path):
    env_file = tmp_path / "custom.env"
    env_file.write_text(
        "OVERPASS_BBOX=[51.0,71.3,51.2,71.5]\n"
        "POI_CACHE_PATH=custom/overpass.json\n"
        "GEMINI_API_KEY=example-secret\nGEMINI_TIMEOUT_SECONDS=4\n",
        encoding="utf-8",
    )
    settings = Settings(_env_file=env_file)
    assert settings.overpass_bbox == (51, 71.3, 51.2, 71.5)
    assert settings.poi_cache_path == BACKEND_DIR / "custom" / "overpass.json"
    assert settings.gemini_timeout_seconds == 4
    assert settings.gemini_api_key.get_secret_value() == "example-secret"
