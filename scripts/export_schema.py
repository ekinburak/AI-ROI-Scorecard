from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import TypeAlias

from pydantic import TypeAdapter

from ai_roi_scorecard.models import EstimateInput, GenerationInput, ScorecardSnapshot

PublicDocument: TypeAlias = GenerationInput | EstimateInput | ScorecardSnapshot


def rendered_schema() -> str:
    schema = TypeAdapter(PublicDocument).json_schema(by_alias=True, union_format="any_of")
    schema["$id"] = "https://github.com/ekinburak/AI-ROI-Scorecard/schema/scorecard-v1.schema.json"
    schema["title"] = "AI ROI Scorecard schema v1"
    return json.dumps(schema, indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    options = parser.parse_args()
    target = Path(__file__).resolve().parents[1] / "schema/scorecard-v1.schema.json"
    content = rendered_schema()
    if options.check:
        if not target.exists() or target.read_text() != content:
            raise SystemExit("schema/scorecard-v1.schema.json is out of date")
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


if __name__ == "__main__":
    main()
