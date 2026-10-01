# Public readiness — living checklist

Update this file with exact commits, CI runs, artifact hashes, registry installations, and live
URLs as evidence becomes available. Local checks and a successful preview are separate from a
public release. Adapter scope remains in [adapters-checklist.md](adapters-checklist.md).

| State | Requirement | Evidence / next action |
| --- | --- | --- |
| Implemented | npm and Python 0.2.0 metadata and matching CLIs | `src/cli.ts`, Python `cli.py`, shared `fixtures/cli`, `scripts/smoke-packages.mjs`. |
| Locally tested | Schema v2, v1 preservation, missing/zero/mixed runtime | Shared v1/v2 golden fixtures and both readiness suites. |
| Locally tested | Atomic replay, same-batch duplicates, conflict rollback | SQLite readiness tests and real PostgreSQL 17 concurrency tests passed in both languages on 2026-10-01. |
| Implemented | Fresh package installations, ESM/CJS and CLI parity | Mandatory installed-artifact smoke script in CI; record current commit's completed run below. |
| Implemented | Copyable brownfield CLI walkthrough | [cli.md](cli.md), OTLP plus JSON/mapping/policy/report fixtures. |
| Implemented | Trusted private-content scans | PR jobs never receive owner terms; trusted main/release jobs require scans of exact artifacts. |
| Implemented | Publication requires same commit's full CI | `release.yml` requires successful main CI, including PostgreSQL and installed packages; downloads its artifacts. |
| Implemented | Safe publication retry | Registry files and checksums verified before reuse; mismatches fail. |
| Passed for initial implementation; final follow-up pending | Full CI matrix and trusted artifact scan | Main commit `398d54a15bf455553e58a14bfe899bec8c9b598a` passed [CI 36833208423](https://github.com/ekinburak/AI-ROI-Scorecard/actions/runs/36833208423), including PostgreSQL, installed packages, and trusted scans. Final release-smoke/input follow-up requires its own main CI. |
| Waiting — external | npm first publication and trusted publisher | Authenticate npm bootstrap of verified tarball if needed; configure repo `ekinburak/AI-ROI-Scorecard`, `release.yml`, environment `release`. |
| Waiting — external | PyPI pending publisher | Owner must register project `ai-roi-scorecard`, same GitHub repo/workflow/environment. |
| Implemented; live run waiting | Public install smoke tests | Release `public-smoke` installs exact 0.2.0 from npm/PyPI and reruns shared CLI contracts before creating the GitHub release. |
| Waiting | Website registry dependency | After npm publication, replace vendored preview archive with exact registry version `0.2.0`. |
| Waiting | Website current CI and browser tests | Calculator, hydration, downloads, mobile layout, CLI documentation must pass on deployed commit. |
| Waiting — external | Cloudflare Pages credentials | Website repo needs `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`; then deploy exact validated output and record live smoke evidence. |

## Release account configuration

Use [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and
[PyPI pending publishers](https://docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/).
The GitHub publisher workflow filename is `release.yml`; environment is `release`. npm's OIDC
client requires npm 11.5.1 or newer (the workflow installs npm 11). If bootstrap is necessary,
download the current successful main CI's `release-packages` artifact, verify its digest and trusted
scan evidence, then publish that exact `.tgz` from an authenticated account. Do not rebuild it.
Configure npm's trusted publisher after creating the package and rerun the workflow; matching
published bytes are verified and preserved.

Completion requires evidence from public npm/PyPI installs and the live Cloudflare website.
Native vendor parsers remain waiting. Scheduling, authentication, delivery, and approval remain
host responsibilities. The CLI intentionally uses SQLite; SDK PostgreSQL support is tested.

## Local verification record — 2026-10-01

- TypeScript: 41 tests passed with PostgreSQL 17 configured; no storage skips.
- Python: 31 tests passed with the same real PostgreSQL service; no storage skips.
- Lint, type checks, schema export synchronization, package version checks, generic boundary
  scans, and runnable examples passed.
- Fresh tarball/wheel installs passed every public npm entry in ESM and CommonJS, both installed
  executables, and `python -m ai_roi_scorecard`. Shared reports/estimates and hashes matched.
  Eight independent CLI replay processes per installation passed, as did invalid units, account
  conflicts, immutable policy imports, output formats, stdin, empty periods, and exit codes.
- Website preview: 6 calculator tests, static build, generic output scan, and 10 browser checks
  passed; 2 desktop instances of mobile-only checks intentionally skip. Browser coverage includes
  dashboard hydration, schema-v2 downloads, copy buttons, CLI fixtures, and mobile documentation.
- Owner-term scans require the repository secret and are verified by trusted CI, not this local
  run. Public registry installations and live deployment remain waiting.
