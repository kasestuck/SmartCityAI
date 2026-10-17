"""Run from the repository root: python -m uvicorn backend.main:app."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from starlette.middleware.cors import CORSMiddleware

from backend.config import Settings
from backend.database.db import Database
from backend.errors import SafeErrorsMiddleware, http_error_handler, validation_error_handler
from backend.routes import health, recommendations
from backend.schemas import ErrorResponse
from backend.services.gemini import GeminiClient


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings if settings is not None else Settings()
    database = Database(settings.database_path)

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        database.initialize()
        yield

    application = FastAPI(
        title="Smart City AI",
        version="0.5.0",
        description="Ассистент прогулок по Астане: реальные POI, геопоиск и Gemini RAG.",
        lifespan=lifespan,
        responses={
            422: {"model": ErrorResponse, "description": "Некорректные параметры запроса"},
            500: {"model": ErrorResponse, "description": "Внутренняя ошибка сервера"},
        },
    )
    application.state.settings = settings
    application.state.database = database
    application.state.gemini = GeminiClient(settings)
    application.add_exception_handler(RequestValidationError, validation_error_handler)
    application.add_exception_handler(HTTPException, http_error_handler)
    application.include_router(health.router)
    application.include_router(recommendations.router)

    # add_middleware prepends: CORS must be outside our exception boundary.
    application.add_middleware(SafeErrorsMiddleware)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
        allow_credentials=False,
    )
    return application


app = create_app()
