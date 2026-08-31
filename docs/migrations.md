# Schema and migrations

The wire format starts at `schemaVersion: 1`. TypeScript and Python share the schema in
`schema/scorecard-v1.schema.json` and the fixtures in `fixtures/`.

Rules:

- Additive optional fields may ship in a minor release when old readers can ignore them.
- Required-field changes, renamed fields, calculation changes, and hash-input changes require a
  new schema version and a major package release after `1.0.0`.
- Never rewrite stored snapshots. Read old versions through explicit migration or compatibility
  functions.
- Keep TypeScript and Python package versions synchronized.
- A storage migration must preserve event sequence numbers, policy versions, source fingerprints,
  and snapshot hashes.

The generic storage schema version is independent of the scorecard wire schema. Hosts using their
own repository implementation own their database migrations.
