"""Conservative name policy shared by collection and legacy POI read paths."""

import json
import re
import unicodedata
from collections.abc import Mapping

NAME_KEYS = ("name", "name:ru", "name:kk", "name:en")
_DASHES = str.maketrans({char: "-" for char in "‐‑‒–—―−"})
_IDENTIFIER = re.compile(
    r"(?:(?:osm[_:/\s-]?)?(?:node|way|relation)[_:/\s-]?\d+"
    r"|(?:id|ref|osm)\s*[_:=/\s-]\s*\d+)",
    re.IGNORECASE,
)
# Require multiple numeric groups: short names such as A8 or Z-1 may be brands.
_MODEL_CODE = re.compile(r"[^\W\d_]{1,4}(?:\s*[-_/]\s*)?\d+(?:\s*[-_/]\s*\d+)+")


def _usable_name(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value or not any(char.isalpha() for char in value):
        return None
    candidate = unicodedata.normalize("NFKC", value).translate(_DASHES)
    if _IDENTIFIER.fullmatch(candidate) or _MODEL_CODE.fullmatch(candidate):
        return None
    return value


def meaningful_name(tags: Mapping[str, object] | None) -> str | None:
    """Use the first meaningful name tag; never substitute a ref or OSM identity."""
    if not isinstance(tags, Mapping):
        return None
    for key in NAME_KEYS:
        name = _usable_name(tags.get(key))
        if name is not None:
            return name
    return None


def safe_display_name(
    name: object, tags_json: str | Mapping[str, object] | None = None
) -> str | None:
    """Repair legacy names from tags and suppress unsafe names before display/AI.

    Nonempty tag objects are authoritative. Older records and compact snapshots
    without tag provenance may retain their stored name if it passes the same
    conservative checks. This function never mutates the source tags.
    """
    tags = tags_json
    if isinstance(tags, str):
        try:
            tags = json.loads(tags)
        except (ValueError, TypeError):
            tags = None
    if isinstance(tags, Mapping) and tags:
        return meaningful_name(tags)
    return _usable_name(name)
