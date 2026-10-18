"""Validate generated explanations and copy public facts from retrieved POI only.

The conservative text guard catches obvious claims, not every possible hallucination.
The prompt and id/schema validation cannot prove arbitrary prose factually correct.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from backend.schemas import (
    QueryContext,
    Recommendation,
    RecommendationRequest,
    RecommendationsResponse,
)
from backend.services.gemini import GeminiClient, GeminiUnavailable
from backend.services.geo_search import VISIT_MINUTES

if TYPE_CHECKING:
    from backend.services.geo_search import Candidate

_CLAIM = re.compile(
    r"открыт|закрыт|\bработает\b|круглосуточ|24\s*/\s*7|"
    r"open\s+now|closed\s+now|(?:is|are)\s+(?:open|closed)\b|"
    r"(?:open|closed)\s+today|currently\s+(?:open|closed)|"
    r"қазір\s+(?:ашық|жабық)|(?:ашық|жабық)\s+қазір|жұмыс\s+істеп\s+тұр|"
    r"розет|wi[\s-]?fi|socket|outlet|бесплатн|\bfree\b|безопасн|\bsafe\b|"
    r"выставк|exhibit|\bevents?\b|событи|мероприяти",
    re.IGNORECASE,
)
_CATEGORY_LABELS = {
    "cafe": "кафе",
    "restaurant": "ресторан",
    "park": "парк",
    "museum": "музей",
    "attraction": "достопримечательность",
    "viewpoint": "смотровая площадка",
    "playground": "детская площадка",
}
_ACTIONS = {
    "cafe": "Рассмотреть кафе для короткого отдыха; перед визитом уточнить часы и условия.",
    "restaurant": "Рассмотреть ресторан для приёма пищи; заранее уточнить часы и условия.",
    "park": "Запланировать короткую прогулку; условия на месте заранее не проверены.",
    "museum": "Рассмотреть посещение музея; заранее уточнить часы, билеты и условия.",
    "attraction": "Рассмотреть осмотр достопримечательности; заранее уточнить условия посещения.",
    "viewpoint": "Рассмотреть посещение смотровой площадки; заранее уточнить условия доступа.",
    "playground": "Рассмотреть детскую площадку; взрослому заранее оценить условия на месте.",
}


def _valid_text(value: object) -> bool:
    return (
        isinstance(value, str)
        and 0 < len(value.strip()) <= 1000
        and not _CLAIM.search(value)
        and not any(ord(character) < 32 and character not in "\n\t\r" for character in value)
    )


def _fallback(candidate: Candidate) -> tuple[str, str]:
    category = _CATEGORY_LABELS.get(candidate.poi.category, "место")
    reason = (
        f"Категория: {category}. Примерно {candidate.distance_meters:.0f} м по прямой; "
        f"дорога к месту и посещение — около {candidate.estimated_duration_minutes} мин. "
        "Соответствие остальным пожеланиям не подтверждено; часы и условия нужно уточнить."
    )
    action = _ACTIONS.get(
        candidate.poi.category,
        "Рассмотреть посещение места; заранее уточнить часы и условия.",
    )
    return reason, action


def build_recommendations(
    request: RecommendationRequest,
    candidates: list[Candidate],
    generator: GeminiClient | None = None,
) -> RecommendationsResponse:
    context = QueryContext(
        latitude=round(request.latitude, 3),
        longitude=round(request.longitude, 3),
        categories=sorted(set(request.categories) & VISIT_MINUTES.keys()),
        duration_minutes=request.duration_minutes,
        transport=request.transport,
    )
    if not candidates:
        return RecommendationsResponse(recommendations=[], query_context=context)
    # Retrieval, including any database errors, happens outside this service.
    by_id = {}
    for candidate in candidates:
        by_id.setdefault(candidate.poi.id, candidate)
    explanations: dict[str, tuple[str, str]] = {}
    if generator is not None:
        try:
            raw = generator.generate(request, list(by_id.values()))
        except (GeminiUnavailable, OSError, ValueError, RuntimeError):
            raw = None
        if (
            isinstance(raw, dict)
            and set(raw) == {"recommendations"}
            and isinstance(raw["recommendations"], list)
        ):
            for item in raw["recommendations"]:
                if not isinstance(item, dict) or set(item) != {"id", "reason", "suggested_action"}:
                    continue
                identity = item["id"]
                if (
                    not isinstance(identity, str)
                    or identity not in by_id
                    or identity in explanations
                    or not _valid_text(item["reason"])
                    or not _valid_text(item["suggested_action"])
                ):
                    continue
                explanations[identity] = (
                    item["reason"].strip(),
                    item["suggested_action"].strip(),
                )
                if len(explanations) == 3:
                    break
    selected = list(explanations)
    for identity in by_id:
        if len(selected) == 3:
            break
        if identity not in explanations:
            selected.append(identity)

    cards = []
    for identity in selected:
        candidate = by_id[identity]
        poi = candidate.poi
        reason, action = explanations.get(identity, _fallback(candidate))
        cards.append(
            Recommendation(
                id=poi.id,
                name=poi.name,
                latitude=poi.latitude,
                longitude=poi.longitude,
                category=poi.category,
                description=poi.description,
                reason=reason,
                distance_meters=candidate.distance_meters,
                estimated_duration_minutes=candidate.estimated_duration_minutes,
                suggested_action=action,
                opening_hours=poi.opening_hours,
                source=poi.source,
                status_note="Часы работы не подтверждены" if poi.opening_hours is None else None,
                generated_by="gemini" if identity in explanations else "fallback_template",
            )
        )
    return RecommendationsResponse(recommendations=cards, query_context=context)
