from typing import Annotated

from fastapi import APIRouter, Depends, Request

from backend.database.db import Database
from backend.schemas import HealthResponse

router = APIRouter(prefix="/api", tags=["health"])


def get_database(request: Request) -> Database:
    return request.app.state.database


@router.get("/health", response_model=HealthResponse)
def health(database: Annotated[Database, Depends(get_database)]) -> HealthResponse:
    database.check_health()
    return HealthResponse()
