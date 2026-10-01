from __future__ import annotations

import re
from datetime import UTC, datetime

from .safety import sanitize_attributes
from .types import NormalizedTelemetrySpan, TelemetrySpanStatus


def _decode_attribute_value(value: dict[str, object]) -> str | int | float | bool | None:
    if "stringValue" in value:
        return str(value["stringValue"])
    if "intValue" in value:
        return int(str(value["intValue"]))
    if "doubleValue" in value:
        raw = value["doubleValue"]
        return float(raw) if isinstance(raw, (int, float, str)) else None
    if "boolValue" in value:
        return bool(value["boolValue"])
    return None


def _attributes_from_otlp(attributes: list[dict[str, object]] | None) -> dict[str, str | int | float | bool]:
    result: dict[str, str | int | float | bool] = {}
    for attribute in attributes or []:
        key = str(attribute.get("key", ""))
        raw_value = attribute.get("value")
        if not key or not isinstance(raw_value, dict):
            continue
        decoded = _decode_attribute_value(raw_value)
        if decoded is None:
            continue
        result[key] = decoded
    return sanitize_attributes(result)


def _nano_to_iso(nano: str | None) -> str | None:
    if nano is None:
        return None
    if not nano.isascii() or not nano.isdigit() or len(nano) > 32:
        raise ValueError("Invalid OTLP timestamp")
    milliseconds = int(int(nano) // 1_000_000)
    return datetime.fromtimestamp(milliseconds / 1000, tz=UTC).isoformat(
        timespec="milliseconds"
    ).replace("+00:00", "Z")


def _map_otlp_status(code: int | None) -> TelemetrySpanStatus:
    if code == 1:
        return "ok"
    if code == 2:
        return "error"
    return "unset"


def parse_otlp_json(payload: dict[str, object], source: str = "otlp") -> list[NormalizedTelemetrySpan]:
    _validate_payload(payload)
    spans: list[NormalizedTelemetrySpan] = []
    resource_spans = payload.get("resourceSpans")
    if resource_spans is None:
        return spans
    if not isinstance(resource_spans, list):
        raise ValueError("resourceSpans must be an array")
    for resource_span in resource_spans:
        if not isinstance(resource_span, dict):
            continue
        scope_spans = resource_span.get("scopeSpans")
        if not isinstance(scope_spans, list):
            continue
        for scope_span in scope_spans:
            if not isinstance(scope_span, dict):
                continue
            raw_spans = scope_span.get("spans")
            if not isinstance(raw_spans, list):
                continue
            for span in raw_spans:
                if not isinstance(span, dict):
                    continue
                source_id = span.get("spanId")
                name = span.get("name")
                if not source_id or not name:
                    continue
                started_at = _nano_to_iso(
                    str(span.get("startTimeUnixNano")) if span.get("startTimeUnixNano") is not None else None
                )
                if not started_at:
                    continue
                ended_at = _nano_to_iso(
                    str(span.get("endTimeUnixNano")) if span.get("endTimeUnixNano") is not None else None
                )
                duration_ms: int | None = None
                start_nano = span.get("startTimeUnixNano")
                end_nano = span.get("endTimeUnixNano")
                if start_nano is not None and end_nano is not None:
                    delta = int(int(str(end_nano)) - int(str(start_nano)))
                    if delta < 0:
                        raise ValueError("Completion precedes start")
                    if delta >= 0:
                        duration_ms = delta // 1_000_000
                status_payload = span.get("status")
                status_code = status_payload.get("code") if isinstance(status_payload, dict) else None
                attributes = span.get("attributes")
                spans.append(
                    NormalizedTelemetrySpan(
                        source=source,
                        source_id=str(source_id),
                        trace_id=str(span.get("traceId") or source_id),
                        name=str(name),
                        started_at=started_at,
                        ended_at=ended_at,
                        duration_ms=duration_ms,
                        status=_map_otlp_status(int(status_code) if status_code is not None else None),
                        attributes=_attributes_from_otlp(
                            attributes if isinstance(attributes, list) else None
                        ),
                    )
                )
    return spans


def _validate_payload(payload: object) -> None:
    def items(container: object, key: str) -> list[dict[str, object]]:
        if not isinstance(container, dict):
            raise ValueError("OTLP containers must be objects")
        value = container.get(key, [])
        if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
            raise ValueError(f"{key} must be an array of objects")
        return value

    for resource in items(payload, "resourceSpans"):
        for scope in items(resource, "scopeSpans"):
            for span in items(scope, "spans"):
                for key in ["traceId", "spanId", "name", "startTimeUnixNano", "endTimeUnixNano"]:
                    if key in span and not isinstance(span[key], str):
                        raise ValueError(f"Invalid {key}")
                for key in ["startTimeUnixNano", "endTimeUnixNano"]:
                    if key in span:
                        _nano_to_iso(str(span[key]))
                if "status" in span:
                    status = span["status"]
                    if not isinstance(status, dict) or ("code" in status and (type(status["code"]) is not int or status["code"] not in [0, 1, 2])):
                        raise ValueError("Invalid OTLP status")
                for attribute in items(span, "attributes"):
                    if not isinstance(attribute.get("key"), str) or not isinstance(attribute.get("value"), dict):
                        raise ValueError("Invalid OTLP attribute")
                    values = attribute["value"]
                    assert isinstance(values, dict)
                    for key, value in values.items():
                        valid = (key == "stringValue" and isinstance(value, str)) or (key == "intValue" and type(value) in [str, int, float]) or (key == "doubleValue" and type(value) in [int, float]) or (key == "boolValue" and isinstance(value, bool))
                        if key == "intValue":
                            if isinstance(value, str):
                                valid = len(value) <= 32 and re.fullmatch(r"-?[0-9]+", value) is not None
                            elif type(value) in [int, float]:
                                valid = value == int(value) and abs(value) <= 9_007_199_254_740_991
                        if key in ["stringValue", "intValue", "doubleValue", "boolValue"] and not valid:
                            raise ValueError("Invalid OTLP attribute value")
