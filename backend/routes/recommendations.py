from typing import Annotated

from fastapi import APIRouter, Depends, Request

from backend.database.db import Database
from backend.routes.health import get_database
from backend.schemas import RecommendationRequest, RecommendationsResponse
from backend.services.gemini import GeminiClient
from backend.services.geo_search import search_poi
from backend.services.rag import build_recommendations

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
    return build_recommendations(payload, candidates, generator)
