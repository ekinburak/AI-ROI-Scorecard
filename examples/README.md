# Generic integration example

The examples simulate a customer-support automation that classifies tickets and drafts replies.
They demonstrate the complete public boundary:

1. instrument work with a stable policy key;
2. append measured evidence;
3. apply an approved manual-time baseline;
4. generate an immutable weekly scorecard; and
5. render HTML and text.

Run TypeScript after `pnpm build`:

```bash
node examples/typescript/support-automation.mjs
```

Run Python after `cd python && uv sync`:

```bash
cd python
uv run python ../examples/python/support_automation.py
```

Both examples use in-memory evidence. Replace the sink with a SQLite, PostgreSQL, or custom
repository in a real host.
