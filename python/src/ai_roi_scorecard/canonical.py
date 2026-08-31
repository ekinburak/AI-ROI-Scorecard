from __future__ import annotations

import hashlib
import json
import math
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel


def _model_payload(value: BaseModel) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for field_name, field in type(value).model_fields.items():
        alias = field.alias or field_name
        entry = getattr(value, field_name)
        if entry is None and not field.is_required():
            continue
        payload[alias] = _normalize(entry)
    return payload


def _normalize(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return _model_payload(value)
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise TypeError("Canonical JSON does not support non-finite numbers")
        return 0 if value == 0 else value
    if isinstance(value, (date, datetime)):
        return value.isoformat().replace("+00:00", "Z")
    if isinstance(value, (list, tuple)):
        return [_normalize(entry) for entry in value]
    if isinstance(value, dict):
        return {str(key): _normalize(entry) for key, entry in value.items()}
    raise TypeError(f"Canonical JSON does not support {type(value).__name__}")


def wire_value(value: Any) -> Any:
    return _normalize(value)


def canonical_json(value: Any) -> str:
    return json.dumps(
        _normalize(value),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def sha256_hex(value: str | bytes) -> str:
    encoded = value.encode("utf-8") if isinstance(value, str) else value
    return hashlib.sha256(encoded).hexdigest()


def sha256_canonical(value: Any) -> str:
    return sha256_hex(canonical_json(value))
