from __future__ import annotations

BLOCKED_ATTRIBUTE_KEYS = {
    "prompt",
    "completion",
    "input",
    "output",
    "email",
    "stack",
    "stacktrace",
    "stack_trace",
    "message",
    "error.message",
    "exception.message",
    "exception.stacktrace",
    "gen_ai.prompt",
    "gen_ai.completion",
    "llm.prompt",
    "llm.completion",
}

ROI_ACCOUNT_ID = "roi.account_id"
ROI_WORKFLOW_KEY = "roi.workflow_key"
ROI_POLICY_KEY = "roi.policy_key"
ROI_OUTCOME_ID = "roi.outcome_id"
ROI_UNITS = "roi.units"

ROI_SEMANTIC_ATTRIBUTES = {
    "account_id": ROI_ACCOUNT_ID,
    "workflow_key": ROI_WORKFLOW_KEY,
    "policy_key": ROI_POLICY_KEY,
    "outcome_id": ROI_OUTCOME_ID,
    "units": ROI_UNITS,
}


def sanitize_attributes(
    attributes: dict[str, str | int | float | bool],
) -> dict[str, str | int | float | bool]:
    sanitized: dict[str, str | int | float | bool] = {}
    for key, value in attributes.items():
        normalized = key.lower()
        if normalized in BLOCKED_ATTRIBUTE_KEYS:
            continue
        if "prompt" in normalized or "completion" in normalized:
            continue
        if "password" in normalized or "token" in normalized:
            continue
        if isinstance(value, str) and "@" in value and "." in value:
            continue
        sanitized[key] = value
    return sanitized


def read_semantic_string(
    attributes: dict[str, str | int | float | bool],
    key: str,
) -> str | None:
    value = attributes.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"Attribute {key} must be a string")
    text = value.strip()
    return text or None


def read_semantic_number(
    attributes: dict[str, str | int | float | bool],
    key: str,
) -> int | None:
    value = attributes.get(key)
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError("Units must be a positive bounded integer")
    number = int(value) if isinstance(value, (int, float)) and value == int(value) else int(value) if isinstance(value, str) and value.isascii() and value.isdigit() else None
    if number is None or not 1 <= number <= 1_000_000_000:
        raise ValueError("Units must be a positive bounded integer")
    return number
