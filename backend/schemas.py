"""Public JSON schemas shared by the routes and OpenAPI."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Latitude = Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]
Longitude = Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)]


class APIModel(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", str_strip_whitespace=True)


class RecommendationRequest(APIModel):
    latitude: Latitude
    longitude: Longitude
    query: Annotated[str, Field(min_length=1, max_length=500)]
    duration_minutes: Annotated[int, Field(ge=15, le=240)]
    transport: Literal["walking"]
    categories: list[str] = Field(default_factory=list)


class Recommendation(APIModel):
    id: str
    name: str
    latitude: Latitude
    longitude: Longitude
    category: str
    description: str | None
    reason: str
    distance_meters: Annotated[float, Field(ge=0, allow_inf_nan=False)]
    estimated_duration_minutes: Annotated[int, Field(gt=0)]
    suggested_action: str
    opening_hours: str | None
    source: str
    status_note: str | None
    generated_by: Literal["gemini", "fallback_template"]


class QueryContext(APIModel):
    latitude: Latitude
    longitude: Longitude
    categories: list[str]
    duration_minutes: Annotated[int, Field(ge=15, le=240)]
    transport: Literal["walking"]


class RecommendationsResponse(APIModel):
    recommendations: Annotated[list[Recommendation], Field(max_length=3)]
    query_context: QueryContext


class HealthResponse(APIModel):
    status: Literal["ok"] = "ok"


class ErrorDetail(APIModel):
    code: str
    message: str


class ErrorResponse(APIModel):
    error: ErrorDetail
