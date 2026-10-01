from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import TypeAdapter, ValidationError

from .adapters import (
    TelemetryEvidenceMapper,
    TelemetryMapping,
    ingest_telemetry_evidence,
    parse_json_records,
    parse_otlp_json,
)
from .adapters.safety import read_semantic_number, read_semantic_string
from .adapters.types import NormalizedTelemetrySpan
from .calculate import estimate_scorecard, generate_scorecard
from .canonical import canonical_json
from .models import GenerationInput, ScorecardSnapshot, ValuePolicy
from .render import render_html_report, render_text_report
from .storage import SqliteScorecardRepository

MAX_INPUT_BYTES = 16 * 1024 * 1024


def _read_json(path: str) -> Any:
    if path == "-":
        data = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    else:
        with Path(path).open("rb") as stream:
            data = stream.read(MAX_INPUT_BYTES + 1)
    if len(data) > MAX_INPUT_BYTES:
        raise ValueError("Input exceeds 16 MiB")
    return json.loads(data)


def _mapping(raw: Any, account: str, mode: str) -> TelemetryMapping:
    if not isinstance(raw, dict) or set(raw) - {"attributes", "workflowsByName"}:
        raise ValueError("Invalid mapping object")
    attributes = raw.get("attributes", {})
    workflows = raw.get("workflowsByName", {})
    if not isinstance(attributes, dict) or set(attributes) - {"workflowKey", "policyKey", "outcomeId", "units"} or any(not isinstance(value, str) for value in attributes.values()):
        raise ValueError("Invalid mapping attributes")
    if not isinstance(workflows, dict) or any(not isinstance(entry, dict) or set(entry) != {"workflowKey", "policyKey"} or any(not isinstance(value, str) for value in entry.values()) for entry in workflows.values()):
        raise ValueError("Invalid workflow mapping")

    def attribute(span: NormalizedTelemetrySpan, key: str) -> str | None:
        name = attributes.get(key)
        return None if name is None else read_semantic_string(span.attributes, name)

    return TelemetryMapping(
        account_id=account,
        duration_mode=mode,  # type: ignore[arg-type]
        workflow_key=lambda span: attribute(span, "workflowKey") or workflows.get(span.name, {}).get("workflowKey"),
        policy_key=lambda span: attribute(span, "policyKey") or workflows.get(span.name, {}).get("policyKey"),
        outcome_id=lambda span: attribute(span, "outcomeId"),
        units=lambda span: None if "units" not in attributes else read_semantic_number(span.attributes, attributes["units"]),
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ai-roi-scorecard", description="Import existing telemetry and produce auditable weekly value reports.")
    parser.add_argument("--version", action="version", version="0.2.0")
    commands = parser.add_subparsers(dest="command")
    init = commands.add_parser("init")
    init.add_argument("--db", required=True)
    ingest = commands.add_parser("ingest")
    ingest.add_argument("--db", required=True)
    ingest.add_argument("--account", required=True)
    ingest.add_argument("--input", required=True)
    ingest.add_argument("--input-format", choices=["otlp", "json"], required=True)
    ingest.add_argument("--mapping")
    ingest.add_argument("--duration-mode", choices=["span", "omit"], default="span")
    ingest.add_argument("--output")
    policies = commands.add_parser("policies")
    policy_commands = policies.add_subparsers(dest="policy_command", required=True)
    policy_import = policy_commands.add_parser("import")
    policy_import.add_argument("--db", required=True)
    policy_import.add_argument("--input", required=True)
    policy_import.add_argument("--output")
    for command in ["report", "estimate", "render"]:
        item = commands.add_parser(command)
        item.add_argument("--input", required=True)
        item.add_argument("--output")
        item.add_argument("--format", choices=["text", "html"] if command == "render" else ["json", "text", "html"], default="text" if command == "render" else "json")
        if command == "report":
            item.add_argument("--db", required=True)
            item.add_argument("--generated-at")
    return parser


def run_cli(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    if args.command is None:
        parser.print_help()
        return 0
    repository: SqliteScorecardRepository | None = None
    data_phase = True
    try:
        snapshot: ScorecardSnapshot | None = None
        result: Any = None
        if args.command == "estimate":
            snapshot = estimate_scorecard(_read_json(args.input))
        elif args.command == "render":
            snapshot = ScorecardSnapshot.model_validate(_read_json(args.input))
        elif args.command == "ingest":
            if not 1 <= len(args.account) <= 256:
                raise ValueError("Invalid account ID")
            payload = _read_json(args.input)
            config = _mapping(_read_json(args.mapping) if args.mapping else {}, args.account, args.duration_mode)
            spans = parse_otlp_json(payload) if args.input_format == "otlp" else parse_json_records(payload)
            if any((account := read_semantic_string(span.attributes, "roi.account_id")) is not None and account != args.account for span in spans):
                raise ValueError("Telemetry account conflicts with --account")
            events = TelemetryEvidenceMapper(config).map_spans(spans)
            data_phase = False
            repository = SqliteScorecardRepository(args.db)
            repository.migrate()
            ingested = ingest_telemetry_evidence(repository, events)
            result = {"spans": len(spans), "mapped": len(events), "appended": len(ingested.appended), "skipped": ingested.skipped}
            if spans and not events:
                print("No spans mapped: supply roi.* tags or --mapping.", file=sys.stderr)
        elif args.command == "policies":
            policies = TypeAdapter(list[ValuePolicy]).validate_python(_read_json(args.input))
            if len(policies) > 1000:
                raise ValueError("No more than 1000 policies are allowed")
            data_phase = False
            repository = SqliteScorecardRepository(args.db)
            repository.migrate()
            known = {}
            for policy in policies:
                for stored in repository.get_policies(policy.account_id or ""):
                    key = (stored.policy_key, stored.version, stored.scope, stored.account_id or "")
                    known[key] = canonical_json(stored)
            for policy in policies:
                key = (policy.policy_key, policy.version, policy.scope, policy.account_id or "")
                payload = canonical_json(policy)
                if key in known and known[key] != payload:
                    raise ValueError("Policy versions are immutable")
                known[key] = payload
            for policy in policies:
                repository.put_policy(policy)
            result = {"imported": len(policies)}
        elif args.command == "report":
            request = _read_json(args.input)
            if not isinstance(request, dict) or set(request) - {"accountId", "locale", "period", "valuation"}:
                raise ValueError("Invalid report request")
            generated_at = args.generated_at or datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            validated = GenerationInput.model_validate({**request, "generatedAt": generated_at, "events": [], "policies": []})
            data_phase = False
            repository = SqliteScorecardRepository(args.db)
            repository.migrate()
            watermark = repository.get_watermark(validated.account_id)
            snapshot = generate_scorecard({**request, "generatedAt": generated_at, "evidenceWatermark": watermark, "events": repository.get_events(validated.account_id, through_sequence=watermark), "policies": repository.get_policies(validated.account_id)})
            repository.put_snapshot(snapshot)
        else:
            data_phase = False
            repository = SqliteScorecardRepository(args.db)
            repository.migrate()
            result = {"initialized": True}
        if snapshot is None:
            output = canonical_json(result)
        elif args.format == "json":
            output = canonical_json(snapshot)
        elif args.format == "text":
            output = render_text_report(snapshot)
        else:
            output = render_html_report(snapshot)
        if getattr(args, "output", None):
            Path(args.output).write_text(output + "\n")
        else:
            sys.stdout.write(output + "\n")
        return 3 if snapshot is not None and snapshot.status == "needs_attention" else 0
    except ValidationError as error:
        print(f"ai-roi-scorecard: {error}", file=sys.stderr)
        return 2
    except (ValueError, TypeError, KeyError, OverflowError) as error:
        print(f"ai-roi-scorecard: {error}", file=sys.stderr)
        return 2 if data_phase or "Conflicting evidence" in str(error) or "immutable" in str(error).lower() else 1
    except Exception as error:
        print(f"ai-roi-scorecard: {error}", file=sys.stderr)
        return 1
    finally:
        if repository is not None:
            repository.close()


def main() -> None:
    raise SystemExit(run_cli())
