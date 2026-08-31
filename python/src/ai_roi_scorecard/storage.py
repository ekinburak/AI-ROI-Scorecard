from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Callable
from contextlib import closing
from typing import Any, Protocol

from pydantic import TypeAdapter

from .canonical import canonical_json
from .models import EvidenceEvent, ScorecardSnapshot, ValuePolicy

event_adapter: TypeAdapter[EvidenceEvent] = TypeAdapter(EvidenceEvent)

SQLITE_MIGRATION = """
CREATE TABLE IF NOT EXISTS roi_account_cursors (
  account_id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL DEFAULT 0 CHECK (sequence >= 0)
);
CREATE TABLE IF NOT EXISTS roi_evidence_events (
  account_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  event_json TEXT NOT NULL,
  PRIMARY KEY (account_id, sequence),
  UNIQUE (account_id, event_id)
);
CREATE TABLE IF NOT EXISTS roi_value_policies (
  policy_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  scope TEXT NOT NULL,
  scope_account TEXT NOT NULL DEFAULT '',
  policy_json TEXT NOT NULL,
  PRIMARY KEY (policy_key, version, scope, scope_account)
);
CREATE TABLE IF NOT EXISTS roi_scorecard_snapshots (
  account_id TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  PRIMARY KEY (account_id, source_fingerprint)
);
"""

POSTGRES_MIGRATION = SQLITE_MIGRATION.replace("INTEGER NOT NULL DEFAULT 0", "BIGINT NOT NULL DEFAULT 0").replace(
    "event_json TEXT NOT NULL", "event_json JSONB NOT NULL"
).replace("policy_json TEXT NOT NULL", "policy_json JSONB NOT NULL").replace(
    "snapshot_json TEXT NOT NULL", "snapshot_json JSONB NOT NULL"
)


class ScorecardRepository(Protocol):
    def migrate(self) -> None: ...
    def append(self, events: list[EvidenceEvent]) -> list[EvidenceEvent]: ...
    def get_events(
        self,
        account_id: str,
        *,
        after_sequence: str | None = None,
        through_sequence: str | None = None,
    ) -> list[EvidenceEvent]: ...
    def get_watermark(self, account_id: str) -> str: ...
    def put_policy(self, policy: ValuePolicy) -> None: ...
    def get_policies(self, account_id: str) -> list[ValuePolicy]: ...
    def put_snapshot(self, snapshot: ScorecardSnapshot) -> ScorecardSnapshot: ...
    def get_snapshot_by_fingerprint(
        self, account_id: str, source_fingerprint: str
    ) -> ScorecardSnapshot | None: ...


class SqliteScorecardRepository:
    def __init__(self, database: str | sqlite3.Connection = ":memory:") -> None:
        self._owns_connection = isinstance(database, str)
        self._connection = (
            sqlite3.connect(database, check_same_thread=False)
            if isinstance(database, str)
            else database
        )
        self._connection.row_factory = sqlite3.Row
        self._lock = threading.RLock()

    def migrate(self) -> None:
        with self._lock:
            self._connection.executescript(SQLITE_MIGRATION)

    def close(self) -> None:
        if self._owns_connection:
            self._connection.close()

    def append(self, events: list[EvidenceEvent]) -> list[EvidenceEvent]:
        if not events:
            return []
        validated = [event_adapter.validate_python(event) for event in events]
        account_id = validated[0].account_id
        if any(event.account_id != account_id for event in validated):
            raise ValueError("One append operation must contain events for exactly one account")
        with self._lock:
            self._connection.execute("BEGIN IMMEDIATE")
            try:
                self._connection.execute(
                    "INSERT OR IGNORE INTO roi_account_cursors (account_id, sequence) VALUES (?, 0)",
                    (account_id,),
                )
                row = self._connection.execute(
                    "SELECT sequence FROM roi_account_cursors WHERE account_id = ?", (account_id,)
                ).fetchone()
                sequence = int(row["sequence"])
                stored: list[EvidenceEvent] = []
                for event in validated:
                    sequence += 1
                    sequenced = event_adapter.validate_python(
                        {**event.model_dump(by_alias=True, exclude_none=True), "sequence": str(sequence)}
                    )
                    self._connection.execute(
                        "INSERT INTO roi_evidence_events (account_id, sequence, event_id, event_json) VALUES (?, ?, ?, ?)",
                        (account_id, sequence, event.event_id, canonical_json(sequenced)),
                    )
                    stored.append(sequenced)
                self._connection.execute(
                    "UPDATE roi_account_cursors SET sequence = ? WHERE account_id = ?",
                    (sequence, account_id),
                )
                self._connection.commit()
                return stored
            except BaseException:
                self._connection.rollback()
                raise

    def get_events(
        self,
        account_id: str,
        *,
        after_sequence: str | None = None,
        through_sequence: str | None = None,
    ) -> list[EvidenceEvent]:
        conditions = ["account_id = ?"]
        values: list[Any] = [account_id]
        if after_sequence is not None:
            conditions.append("sequence > ?")
            values.append(int(after_sequence))
        if through_sequence is not None:
            conditions.append("sequence <= ?")
            values.append(int(through_sequence))
        rows = self._connection.execute(
            f"SELECT event_json FROM roi_evidence_events WHERE {' AND '.join(conditions)} ORDER BY sequence",
            values,
        ).fetchall()
        return [event_adapter.validate_python(json.loads(row["event_json"])) for row in rows]

    def get_watermark(self, account_id: str) -> str:
        row = self._connection.execute(
            "SELECT sequence FROM roi_account_cursors WHERE account_id = ?", (account_id,)
        ).fetchone()
        return str(row["sequence"] if row else 0)

    def put_policy(self, policy: ValuePolicy) -> None:
        validated = ValuePolicy.model_validate(policy)
        scope_account = validated.account_id if validated.scope == "account" else ""
        payload = canonical_json(validated)
        self._connection.execute(
            "INSERT OR IGNORE INTO roi_value_policies (policy_key, version, scope, scope_account, policy_json) VALUES (?, ?, ?, ?, ?)",
            (validated.policy_key, validated.version, validated.scope, scope_account, payload),
        )
        row = self._connection.execute(
            "SELECT policy_json FROM roi_value_policies WHERE policy_key = ? AND version = ? AND scope = ? AND scope_account = ?",
            (validated.policy_key, validated.version, validated.scope, scope_account),
        ).fetchone()
        self._connection.commit()
        if row["policy_json"] != payload:
            raise ValueError("Approved policy versions are immutable")

    def get_policies(self, account_id: str) -> list[ValuePolicy]:
        rows = self._connection.execute(
            "SELECT policy_json FROM roi_value_policies WHERE scope = 'default' OR (scope = 'account' AND scope_account = ?) ORDER BY policy_key, version",
            (account_id,),
        ).fetchall()
        return [ValuePolicy.model_validate_json(row["policy_json"]) for row in rows]

    def put_snapshot(self, snapshot: ScorecardSnapshot) -> ScorecardSnapshot:
        validated = ScorecardSnapshot.model_validate(snapshot)
        payload = canonical_json(validated)
        self._connection.execute(
            "INSERT OR IGNORE INTO roi_scorecard_snapshots (account_id, source_fingerprint, snapshot_hash, snapshot_json) VALUES (?, ?, ?, ?)",
            (
                validated.account_id,
                validated.source_fingerprint,
                validated.snapshot_hash,
                payload,
            ),
        )
        self._connection.commit()
        existing = self.get_snapshot_by_fingerprint(
            validated.account_id, validated.source_fingerprint
        )
        if existing is None or existing.snapshot_hash != validated.snapshot_hash:
            raise ValueError("A source fingerprint cannot identify two different snapshots")
        return existing

    def get_snapshot_by_fingerprint(
        self, account_id: str, source_fingerprint: str
    ) -> ScorecardSnapshot | None:
        row = self._connection.execute(
            "SELECT snapshot_json FROM roi_scorecard_snapshots WHERE account_id = ? AND source_fingerprint = ?",
            (account_id, source_fingerprint),
        ).fetchone()
        return ScorecardSnapshot.model_validate_json(row["snapshot_json"]) if row else None


class PostgresScorecardRepository:
    def __init__(self, connection_factory: Callable[[], Any]) -> None:
        self._connection_factory = connection_factory

    @classmethod
    def connect(cls, dsn: str) -> PostgresScorecardRepository:
        try:
            import psycopg
        except ImportError as error:
            raise RuntimeError("Install ai-roi-scorecard[postgres] to use PostgreSQL") from error
        return cls(lambda: psycopg.connect(dsn))

    def migrate(self) -> None:
        with closing(self._connection_factory()) as connection, connection.cursor() as cursor:
            cursor.execute(POSTGRES_MIGRATION)
            connection.commit()

    def close(self) -> None:
        return None

    def append(self, events: list[EvidenceEvent]) -> list[EvidenceEvent]:
        if not events:
            return []
        validated = [event_adapter.validate_python(event) for event in events]
        account_id = validated[0].account_id
        if any(event.account_id != account_id for event in validated):
            raise ValueError("One append operation must contain events for exactly one account")
        with closing(self._connection_factory()) as connection, connection.cursor() as cursor:
            try:
                cursor.execute(
                    "INSERT INTO roi_account_cursors (account_id, sequence) VALUES (%s, 0) ON CONFLICT(account_id) DO NOTHING",
                    (account_id,),
                )
                cursor.execute(
                    "SELECT sequence FROM roi_account_cursors WHERE account_id = %s FOR UPDATE",
                    (account_id,),
                )
                sequence = int(cursor.fetchone()[0])
                stored: list[EvidenceEvent] = []
                for event in validated:
                    sequence += 1
                    sequenced = event_adapter.validate_python(
                        {**event.model_dump(by_alias=True, exclude_none=True), "sequence": str(sequence)}
                    )
                    cursor.execute(
                        "INSERT INTO roi_evidence_events (account_id, sequence, event_id, event_json) VALUES (%s, %s, %s, %s::jsonb)",
                        (account_id, sequence, event.event_id, canonical_json(sequenced)),
                    )
                    stored.append(sequenced)
                cursor.execute(
                    "UPDATE roi_account_cursors SET sequence = %s WHERE account_id = %s",
                    (sequence, account_id),
                )
                connection.commit()
                return stored
            except BaseException:
                connection.rollback()
                raise

    def get_events(
        self,
        account_id: str,
        *,
        after_sequence: str | None = None,
        through_sequence: str | None = None,
    ) -> list[EvidenceEvent]:
        conditions = ["account_id = %s"]
        values: list[Any] = [account_id]
        if after_sequence is not None:
            conditions.append("sequence > %s")
            values.append(int(after_sequence))
        if through_sequence is not None:
            conditions.append("sequence <= %s")
            values.append(int(through_sequence))
        with closing(self._connection_factory()) as connection, connection.cursor() as cursor:
            cursor.execute(
                f"SELECT event_json FROM roi_evidence_events WHERE {' AND '.join(conditions)} ORDER BY sequence",
                values,
            )
            return [event_adapter.validate_python(row[0]) for row in cursor.fetchall()]

    def get_watermark(self, account_id: str) -> str:
        with closing(self._connection_factory()) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT sequence FROM roi_account_cursors WHERE account_id = %s", (account_id,)
            )
            row = cursor.fetchone()
            return str(row[0] if row else 0)

    def put_policy(self, policy: ValuePolicy) -> None:
        validated = ValuePolicy.model_validate(policy)
        scope_account = validated.account_id if validated.scope == "account" else ""
        payload = canonical_json(validated)
        with closing(self._connection_factory()) as connection, connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO roi_value_policies (policy_key, version, scope, scope_account, policy_json) VALUES (%s, %s, %s, %s, %s::jsonb) ON CONFLICT DO NOTHING",
                (validated.policy_key, validated.version, validated.scope, scope_account, payload),
            )
            cursor.execute(
                "SELECT policy_json FROM roi_value_policies WHERE policy_key = %s AND version = %s AND scope = %s AND scope_account = %s",
                (validated.policy_key, validated.version, validated.scope, scope_account),
            )
            stored = cursor.fetchone()[0]
            connection.commit()
            if canonical_json(stored) != payload:
                raise ValueError("Approved policy versions are immutable")

    def get_policies(self, account_id: str) -> list[ValuePolicy]:
        with closing(self._connection_factory()) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT policy_json FROM roi_value_policies WHERE scope = 'default' OR (scope = 'account' AND scope_account = %s) ORDER BY policy_key, version",
                (account_id,),
            )
            return [ValuePolicy.model_validate(row[0]) for row in cursor.fetchall()]

    def put_snapshot(self, snapshot: ScorecardSnapshot) -> ScorecardSnapshot:
        validated = ScorecardSnapshot.model_validate(snapshot)
        with closing(self._connection_factory()) as connection, connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO roi_scorecard_snapshots (account_id, source_fingerprint, snapshot_hash, snapshot_json) VALUES (%s, %s, %s, %s::jsonb) ON CONFLICT DO NOTHING",
                (
                    validated.account_id,
                    validated.source_fingerprint,
                    validated.snapshot_hash,
                    canonical_json(validated),
                ),
            )
            connection.commit()
        existing = self.get_snapshot_by_fingerprint(
            validated.account_id, validated.source_fingerprint
        )
        if existing is None or existing.snapshot_hash != validated.snapshot_hash:
            raise ValueError("A source fingerprint cannot identify two different snapshots")
        return existing

    def get_snapshot_by_fingerprint(
        self, account_id: str, source_fingerprint: str
    ) -> ScorecardSnapshot | None:
        with closing(self._connection_factory()) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT snapshot_json FROM roi_scorecard_snapshots WHERE account_id = %s AND source_fingerprint = %s",
                (account_id, source_fingerprint),
            )
            row = cursor.fetchone()
            return ScorecardSnapshot.model_validate(row[0]) if row else None
