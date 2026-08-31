# Shared wire schema

`scorecard-v1.schema.json` describes the public generation input, illustrative estimate input, and
immutable snapshot documents. Both SDKs validate the same camelCase wire format and prove parity
against the fixtures in `../fixtures/`.

Regenerate and verify it from the Python models:

```bash
cd python
uv run python ../scripts/export_schema.py
uv run python ../scripts/export_schema.py --check
```
