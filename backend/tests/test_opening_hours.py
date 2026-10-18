from datetime import UTC, datetime

import pytest

from backend.services.opening_hours import evaluate_opening_hours


@pytest.mark.parametrize(
    ("value", "instant", "expected"),
    [
        ("24/7", "2026-10-18T22:00:00+00:00", True),
        ("off", "2026-10-19T06:00:00+00:00", False),
        ("Mo-Fr 09:00-18:00", "2026-10-19T06:00:00+00:00", True),
        ("Mo-Fr 09:00-18:00", "2026-10-19T14:00:00+00:00", False),
        ("Mo-Fr 09:00-18:00", "2026-10-18T06:00:00+00:00", False),
        ("Mo 09:00-18:00", "2026-10-19T04:00:00+00:00", True),
        ("Mo 09:00-18:00", "2026-10-19T13:00:00+00:00", False),
        ("Mo 09:00-12:00,14:00-18:00", "2026-10-19T08:00:00+00:00", False),
        ("Mo 09:00-12:00,14:00-18:00", "2026-10-19T10:00:00+00:00", True),
        ("Mo 22:00-02:00", "2026-10-19T20:00:00+00:00", True),
        ("Mo 02:00-04:00", "2026-10-18T22:00:00+00:00", True),
        ("Su 02:00-04:00", "2026-10-18T22:00:00+00:00", False),
        ("Mo 02:00-04:00", "2026-10-19T00:00:00+02:00", True),
    ],
)
def test_evaluates_schedule_at_astana_local_time(value, instant, expected):
    assert evaluate_opening_hours(value, now=datetime.fromisoformat(instant)) is expected


@pytest.mark.parametrize("value", [None, "", "  ", "nonsense", "Mo 29:00-30:00", "unknown"])
def test_unavailable_invalid_or_unknown_schedule_has_no_status(value):
    assert evaluate_opening_hours(value, now=datetime(2026, 10, 19, 6, tzinfo=UTC)) is None


@pytest.mark.parametrize(
    "value",
    [
        "Mo-Fr 09:00-18:00; PH off",
        "PH09:00-18:00",
        "24/7; SH off",
        "sunrise-sunset",
        "dawn-dusk",
        "Mo-Fr 09:00-sunset",
    ],
)
def test_rules_requiring_calendar_or_coordinates_have_no_status(value):
    assert evaluate_opening_hours(value, now=datetime(2026, 10, 19, 6, tzinfo=UTC)) is None


def test_uses_current_server_instant_when_now_is_omitted(monkeypatch):
    from backend.services import opening_hours

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            # Sunday in UTC is already Monday morning in Astana.
            return datetime(2026, 10, 18, 22, tzinfo=UTC).astimezone(tz)

    monkeypatch.setattr(opening_hours, "datetime", FixedDateTime)

    assert evaluate_opening_hours("Mo 02:00-04:00") is True


def test_time_without_timezone_has_no_status():
    assert evaluate_opening_hours("24/7", now=datetime(2026, 10, 19, 6)) is None
