# Storage adapters

The pure calculation functions accept supplied events and policies. Storage is optional and lives
behind repository contracts.

## Guarantees

Both SQLite and PostgreSQL adapters provide:

- append-only evidence events;
- commit-ordered per-account sequence numbers;
- stable evidence watermarks;
- immutable policy versions;
- immutable snapshots keyed by source fingerprint; and
- idempotent reads and snapshot writes.

An append call must contain events for exactly one account and commits atomically.

## TypeScript

SQLite uses the Node.js 22.13+ `node:sqlite` module:

```ts
import { SqliteScorecardRepository } from "ai-roi-scorecard/storage/sqlite";

const repository = new SqliteScorecardRepository("./scorecards.sqlite");
await repository.migrate();
```

PostgreSQL accepts a pool-compatible object, including `pg.Pool`:

```ts
import { Pool } from "pg";
import { PostgresScorecardRepository } from "ai-roi-scorecard/storage/postgres";

const repository = new PostgresScorecardRepository(new Pool({ connectionString }));
await repository.migrate();
```

## Python

```python
from ai_roi_scorecard import SqliteScorecardRepository

repository = SqliteScorecardRepository("./scorecards.sqlite")
repository.migrate()
```

For PostgreSQL, install the optional extra and use a DSN:

```python
from ai_roi_scorecard import PostgresScorecardRepository

repository = PostgresScorecardRepository.connect(dsn)
repository.migrate()
```

The generic tables are prefixed with `roi_`. A host with an existing ledger may implement the
repository protocols instead of using these tables.

## Atomic replay ingestion

`append` is strict: duplicate event IDs fail. `appendIfAbsent` / `append_if_absent` skips
identical payloads (ignoring assigned sequence), including duplicates in one batch and
concurrent replay. Conflicting payloads roll back the entire batch without advancing its cursor.
Built-in adapters serialize account writers; SQLite waits up to 30 seconds for a write lock.
Custom repositories lacking this capability require a single ingestion writer.
