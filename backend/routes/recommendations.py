from typing import Annotated

from fastapi import APIRouter, Depends, Request

from backend.database.db import Database
from backend.routes.health import get_database
from backend.schemas import RecommendationRequest, RecommendationsResponse
from backend.services.gemini import GeminiClient
from backend.services.geo_search import search_poi
from backend.services.rag import build_recommendations
from backend.services.transit import attach_nearest_stops

router = APIRouter(prefix="/api", tags=["recommendations"])


def get_gemini(request: Request) -> GeminiClient:
    return request.app.state.gemini


@router.post("/recommendations", response_model=RecommendationsResponse)
def recommendations(
    payload: RecommendationRequest,
    database: Annotated[Database, Depends(get_database)],
    generator: Annotated[GeminiClient, Depends(get_gemini)],
) -> RecommendationsResponse:
    candidates = search_poi(database, payload)
    candidates = attach_nearest_stops(database, candidates)
    result = build_recommendations(payload, candidates, generator)
    if result.recommendations:
        # Probe retrieval only: the shortlist is capped and a short-budget page may
        # contain one result. Neither page length nor the Gemini response proves
        # exhaustion. Do not make an additional model call for this check.
        remaining = payload.model_copy(
            update={
                "exclude_ids": list(
                    set(payload.exclude_ids) | {card.id for card in result.recommendations}
                )
            }
        )
        result.has_more = bool(search_poi(database, remaining, limit=1))
    return result
