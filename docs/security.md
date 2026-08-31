# Security and privacy

The SDK is designed to keep report evidence narrow.

- Use opaque account, run, attempt, outcome, exception, and approval identifiers.
- Record allowlisted exception categories, not stack traces, credentials, prompts, raw provider
  responses, or customer content.
- Keep recipient selection, authentication, authorization, scheduling, and delivery in the host.
- Escape all presentation labels and account names.
- Store the source fingerprint, snapshot hash, artifact hash, renderer version, and evidence
  watermark with each approved report.
- Treat an indeterminate delivery as a host-level concern; the SDK does not retry email.

The repository's CI scans source and package artifacts for private paths, credential patterns, and
an owner-maintained list of boundary terms. Applications should add their own customer-specific
denylist before publishing artifacts.
