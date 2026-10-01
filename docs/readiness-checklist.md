# Public readiness — living checklist

Update this file with exact commits, CI runs, artifact hashes, registry installations, and live
URLs as evidence becomes available. Local checks and a successful preview are separate from a
public release. Adapter scope remains in [adapters-checklist.md](adapters-checklist.md).

| State | Requirement | Evidence / next action |
| --- | --- | --- |
| Implemented | npm and Python 0.2.0 metadata and matching CLIs | `src/cli.ts`, Python `cli.py`, shared `fixtures/cli`, `scripts/smoke-packages.mjs`. |
| Locally tested | Schema v2, v1 preservation, missing/zero/mixed runtime | Shared v1/v2 golden fixtures and both readiness suites. |
| Locally tested | Atomic replay, same-batch duplicates, conflict rollback | SQLite readiness tests and real PostgreSQL 17 concurrency tests passed in both languages on 2026-10-01. |
| Passed | Fresh package installations, ESM/CJS and CLI parity | [Final SDK CI](https://github.com/ekinburak/AI-ROI-Scorecard/actions/runs/36835063785) passed the installed-artifact contracts on main. |
| Implemented | Copyable brownfield CLI walkthrough | [cli.md](cli.md), OTLP plus JSON/mapping/policy/report fixtures. |
| Implemented | Trusted private-content scans | PR jobs never receive owner terms; trusted main/release jobs require scans of exact artifacts. |
| Implemented | Publication requires same commit's full CI | `release.yml` requires successful main CI, including PostgreSQL and installed packages; downloads its artifacts. |
| Implemented | Safe publication retry | Registry files and checksums verified before reuse; mismatches fail. |
| Passed | Full CI matrix and trusted artifact scan | Main commit `94b1673905896d078191b0b9d843d52a6dd15153` passed [CI 36835063785](https://github.com/ekinburak/AI-ROI-Scorecard/actions/runs/36835063785): Node 22/24/26, Python 3.11–3.14, PostgreSQL, installed packages, and mandatory trusted scans. Publication requires the exact SHA being released to pass main CI. |
| Waiting — external | npm first publication and trusted publisher | Authenticate npm bootstrap of verified tarball if needed; configure repo `ekinburak/AI-ROI-Scorecard`, `release.yml`, environment `release`. |
| Waiting — external | PyPI pending publisher | Owner must register project `ai-roi-scorecard`, same GitHub repo/workflow/environment. |
| Implemented; live run waiting | Public install smoke tests | Release `public-smoke` installs exact 0.2.0 from npm/PyPI and reruns shared CLI contracts before creating the GitHub release. |
| Waiting | Website registry dependency | After npm publication, replace vendored preview archive with exact registry version `0.2.0`. |
| Passed | Website main CI and browser tests | Commit `97449fe0a5a947e3dff6c869e8c4e23c00aa0ffb` passed [CI 36835301190](https://github.com/ekinburak/AI-ROI-Scorecard-Website/actions/runs/36835301190), including trusted output scans. Registry replacement requires a new full run before deployment. |
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


## Tested CI artifact record

Artifacts from SDK CI `36835063785` (code commit `94b1673`), all SHA-256:

| File | Digest |
| --- | --- |
| `ai-roi-scorecard-0.2.0.tgz` | `94e18ec8c117ac2d58d47de53c38e1b1a159fc19d5d65be805f1c46101da293e` |
| `ai_roi_scorecard-0.2.0-py3-none-any.whl` | `62a58f8f25fa332b69e77ca92358829a51488cbf800ede2995b9575fb3bd99cf` |
| `ai_roi_scorecard-0.2.0.tar.gz` | `eb6b8ab30aa1010b8f5fdc56926751ddebd3c84decc8b504990d50b460af0037` |

On 2026-10-01 both registry version lookups returned absent. Local npm sign-in was unavailable;
the website repository contained neither Cloudflare deployment secret. PyPI pending-publisher
configuration remains unverified until owner setup and a successful OIDC publication. The website
keeps its preview archive until npm publication, and the deployment gate refuses that dependency.
Account actions are required to finish the live acceptance criteria.

This ledger records completed runs rather than claiming that a later documentation commit was
already tested. The release workflow always fetches the exact successful main-CI artifacts for
its own commit; refresh these digests if the final artifacts differ.
