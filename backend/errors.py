"""Stable public errors without exception details or request data."""

import logging

from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from backend.schemas import ErrorDetail, ErrorResponse

logger = logging.getLogger(__name__)

HTTP_ERRORS = {
    400: ("VALIDATION_ERROR", "Некорректные параметры запроса"),
    404: ("NOT_FOUND", "Ресурс не найден"),
    405: ("METHOD_NOT_ALLOWED", "Метод не поддерживается"),
    422: ("VALIDATION_ERROR", "Некорректные параметры запроса"),
    429: ("RATE_LIMITED", "Слишком много запросов"),
    500: ("INTERNAL_ERROR", "Внутренняя ошибка сервера"),
    503: ("AI_UNAVAILABLE", "AI-сервис временно недоступен"),
}


def error_response(status: int, headers: dict[str, str] | None = None) -> JSONResponse:
    code, message = HTTP_ERRORS.get(status, ("HTTP_ERROR", "Не удалось выполнить запрос"))
    body = ErrorResponse(error=ErrorDetail(code=code, message=message))
    return JSONResponse(status_code=status, content=body.model_dump(), headers=headers)


async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    # Pydantic errors can contain the raw input, including NaN or personal data.
    return error_response(422)


async def http_error_handler(request: Request, exc: HTTPException) -> JSONResponse:
    return error_response(exc.status_code, headers=exc.headers)


class SafeErrorsMiddleware:
    """Catch failures inside CORS so error responses keep the allowed origin."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def tracked_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, tracked_send)
        except Exception:
            # Never log the exception, body, URL query, prompt or precise location.
            logger.error("An internal application error occurred")
            if response_started:
                raise
            await error_response(500)(scope, receive, send)
