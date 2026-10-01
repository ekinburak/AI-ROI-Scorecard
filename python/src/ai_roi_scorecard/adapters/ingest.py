from __future__ import annotations

from dataclasses import dataclass

from ..models import EvidenceEvent
from ..storage import ScorecardRepository, _evidence_payload, event_adapter


@dataclass(frozen=True)
class TelemetryIngestResult:
    appended: list[EvidenceEvent]
    skipped: int


def ingest_telemetry_evidence(repository: ScorecardRepository, events: list[EvidenceEvent]) -> TelemetryIngestResult:
    events = [event_adapter.validate_python(event) for event in events]
    if not events:
        return TelemetryIngestResult(appended=[], skipped=0)
    account_id = events[0].account_id
    if any(event.account_id != account_id for event in events):
        raise ValueError("One ingest operation must contain events for exactly one account")
    atomic_append = getattr(repository, "append_if_absent", None)
    if callable(atomic_append):
        appended = atomic_append(events)
    else:
        known = {event.event_id: _evidence_payload(event) for event in repository.get_events(account_id)}
        fresh = []
        for event in events:
            payload = _evidence_payload(event)
            previous = known.get(event.event_id)
            if previous is not None and previous != payload:
                raise ValueError("Conflicting evidence for an existing event ID")
            if previous is None:
                fresh.append(event)
            known[event.event_id] = payload
        appended = repository.append(fresh) if fresh else []
    return TelemetryIngestResult(appended=appended, skipped=len(events) - len(appended))
