"""Small RU/KK/EN intent dictionary; it is not general language understanding.

Concrete categories constrain retrieval. Vague interests only affect ranking.
Keep the original query untouched for explanations; normalize a copy for matching.
"""

import re
import unicodedata

from backend.schemas import RecommendationRequest

# English words have boundaries (park != parking). Cyrillic roots cover ordinary
# Russian/Kazakh endings; multiword categories require the full phrase.
_CATEGORY_PATTERNS = {
    "cafe": r"\b(?:кафе|кофе\w*|кофей\w*|coffee|caf[eé]s?)\b",
    # асхана is a canteen, grouped into the existing food category, not an exact synonym.
    "restaurant": r"\b(?:ресторан\w*|мейрамхана\w*|асхана\w*|restaurants?)\b",
    "museum": r"\b(?:музе\w*|мұражай\w*|museums?)\b",
    "park": r"\b(?:парк(?!ов(?:к|а)|инг|у[юй])\w*|саяба[қғ]\w*|parks?)\b",
    "attraction": (
        r"\b(?:достопримечательност\w*|landmarks?|attractions?|атт?ракцион\w*)\b"
        r"|\bкөрікті\s+(?:жер|орын)\w*\b"
    ),
    "viewpoint": (
        r"\b(?:смотров\w*\s+(?:площадк|пункт)\w*|шолу\s+алаң\w*|панорам\w*"
        r"|viewpoints?|lookouts?|observation\s+(?:decks?|points?))\b"
    ),
    "playground": (
        r"\b(?:детск\w*\s+(?:игров\w*\s+)?площадк\w*|playgrounds?"
        r"|(?:балалар\w*\s+(?:ойын\s+)?|ойын\s+)алаң\w*)\b"
    ),
}
SUPPORTED_CATEGORIES = frozenset(_CATEGORY_PATTERNS)

# Bounded activity synonyms, used when there is no more specific category noun.
# Coordinated wishes ("coffee and a walk") can combine categories as alternatives.
_ACTIVITY_PATTERNS = {
    "museum": r"\b(?:истори\w*|history|historical|тарих\w*)\b",
    "restaurant": (
        r"\b(?:пообеда\w*|поужина\w*|обед\w*|ужин\w*|dinner|lunch|dine|dining"
        r"|тамақтан\w*|түскі\s+ас|кешкі\s+ас)\b"
    ),
    "playground": r"\b(?:качел\w*|swings?|slides?|әткеншек\w*)\b",
    "viewpoint": (
        r"\b(?:город\w*\s+с\s+высот\w*|city\s+from\s+above"
        r"|қала\w*\s+биіктен)\b"
    ),
    "park": r"\b(?:прогул\w*|прогуля\w*|серуен\w*|stroll(?:s|ing)?|a\s+walk)\b",
}
_CATEGORY_RULES = {
    category: re.compile(pattern) for category, pattern in _CATEGORY_PATTERNS.items()
}
_ACTIVITY_RULES = {
    category: re.compile(pattern) for category, pattern in _ACTIVITY_PATTERNS.items()
}
# Preserve the established mixed "coffee and a walk" scenario without treating
# any contextual "and" ("a park and its history") as a separate museum request.
_WALK = r"(?:прогул\w*|прогуля\w*|walk|stroll|серуен\w*)"
_COORDINATED_WALK = re.compile(
    rf"\b(?:и|and|және)\s+(?:(?:a|short|коротк\w*)\s+)*{_WALK}\b"
    rf"|\b{_WALK}\s+(?:и|and|және)\b"
)
_BROAD_PREFERENCES = (
    (
        re.compile(r"\b(?:walk|walking|stroll|гуля\w*|серуен\w*)\b"),
        {"park", "attraction", "viewpoint"},
    ),
    (
        re.compile(
            r"\b(?:ребен\w*|дет\w*|семь\w*|семей\w*|family|families|kids?|"
            r"child|children|балалар\w*|отбас\w*)\b"
        ),
        {"park", "playground", "museum"},
    ),
    (re.compile(r"\b(?:турист\w*|tourists?|sightseeing)\b"), {"museum", "attraction", "viewpoint"}),
)


def normalize_text(text: str) -> str:
    return " ".join(unicodedata.normalize("NFC", text).casefold().replace("ё", "е").split())


def inferred_categories(query: str) -> set[str]:
    text = normalize_text(query)
    # This idiom describes looking for something, not an observation point.
    text = re.sub(r"\bon the lookout for\b", " ", text)
    explicit = {category for category, pattern in _CATEGORY_RULES.items() if pattern.search(text)}
    activities = {category for category, pattern in _ACTIVITY_RULES.items() if pattern.search(text)}
    if explicit:
        return explicit | {"park"} if _COORDINATED_WALK.search(text) else explicit
    return activities


def applied_categories(request: RecommendationRequest) -> list[str]:
    """Resolve one shared filter for SQL, response context and Gemini's data."""
    if request.categories:
        # An explicit unknown filter must stay empty, not fall back to query inference.
        return sorted(set(request.categories) & SUPPORTED_CATEGORIES)
    return sorted(inferred_categories(request.query))


def preferred_categories(query: str) -> set[str]:
    """Keep broad, ambiguous interests as ranking hints rather than hard filters."""
    text = normalize_text(query)
    return {
        category
        for pattern, categories in _BROAD_PREFERENCES
        if pattern.search(text)
        for category in categories
    }
