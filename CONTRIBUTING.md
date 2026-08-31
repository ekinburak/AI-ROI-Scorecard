# Contributing

Thank you for improving AI ROI Scorecard.

1. Open an issue for material API or schema changes before implementation.
2. Keep the core provider-neutral and free of host-specific workflows, recipients, schedulers,
   authentication, or customer information.
3. Add equivalent TypeScript and Python behavior for shared schema or calculation changes.
4. Add or update a cross-language golden fixture when canonical output changes.
5. Add a Changeset for user-visible package changes.

Run before opening a pull request:

```bash
pnpm install
pnpm check
cd python
uv sync --all-extras
uv run ruff check src tests
uv run mypy src
uv run pytest
```

Never commit credentials, customer data, private repository paths, provider diagnostics, or raw
exception payloads.
