"""Environment-backed settings anchored to the backend directory."""

import math
from pathlib import Path

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    database_path: Path = BACKEND_DIR / "data" / "poi.sqlite3"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    overpass_url: str = "https://overpass-api.de/api/interpreter"
    overpass_bbox: tuple[float, float, float, float] = (50.95, 71.20, 51.30, 71.75)
    overpass_timeout_seconds: float = Field(default=45, gt=0, le=120, allow_inf_nan=False)
    overpass_attempts: int = Field(default=3, ge=1, le=5)
    overpass_retry_delay_seconds: float = Field(default=2, ge=0, le=30, allow_inf_nan=False)
    poi_cache_path: Path = BACKEND_DIR / "cache" / "overpass.json"
    transit_cache_path: Path = BACKEND_DIR / "cache" / "transit-overpass.json"
    poi_cache_ttl_seconds: int = Field(default=86400, ge=0)
    gemini_api_key: SecretStr = SecretStr("")
    gemini_model: str = Field(
        default="gemini-3.8-flash", pattern=r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$"
    )
    gemini_timeout_seconds: float = Field(default=8, gt=0, le=30, allow_inf_nan=False)

    @field_validator("database_path", "poi_cache_path", "transit_cache_path", mode="after")
    @classmethod
    def resolve_database_path(cls, value: Path) -> Path:
        if not value.is_absolute():
            value = BACKEND_DIR / value
        return value.resolve()

    @field_validator("overpass_bbox")
    @classmethod
    def validate_bbox(cls, value: tuple[float, float, float, float]):
        south, west, north, east = value
        if not all(math.isfinite(number) for number in value):
            raise ValueError("Bounding box must contain finite coordinates")
        if not (-90 <= south < north <= 90 and -180 <= west < east <= 180):
            raise ValueError("Bounding box must be south, west, north, east")
        return value
