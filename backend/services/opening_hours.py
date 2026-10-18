import re
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from opening_hours import OpeningHours, ParserError, State

_ASTANA_TIMEZONE = ZoneInfo("Asia/Almaty")
_NEEDS_LOCAL_CONTEXT = re.compile(r"\b(?:PH|SH|sunrise|sunset|dawn|dusk)\b")


def evaluate_opening_hours(value: str | None, *, now: datetime | None = None) -> bool | None:
    """Return known open/closed state in Astana, or None when indeterminate.

    An explicit ``now`` must identify an aware instant. When omitted, the
    current UTC server instant is used. Parsing and evaluation belong to
    opening-hours-py; parser warnings also leave the status unknown.
    Expressions mentioning holidays (PH/SH) or solar events stay unknown:
    this adapter has no verified holiday calendar or place coordinates.
    The conservative context guard can also match words in OSM comments.
    """
    if not value or not value.strip():
        return None

    instant = now if now is not None else datetime.now(UTC)
    if instant.tzinfo is None or instant.utcoffset() is None:
        return None

    try:
        schedule = OpeningHours(value, timezone=_ASTANA_TIMEZONE)
        # Inspect the library's rendering only to reject unavailable context,
        # never to parse or evaluate OSM rules ourselves.
        if schedule.warnings or _NEEDS_LOCAL_CONTEXT.search(str(schedule)):
            return None
        # The binding requires ZoneInfo for aware times, including UTC inputs.
        state, _comment = schedule.state(instant.astimezone(_ASTANA_TIMEZONE))
    except (ParserError, ValueError, TypeError, OverflowError):
        return None

    if state == State.OPEN:
        return True
    if state == State.CLOSED:
        return False
    return None
