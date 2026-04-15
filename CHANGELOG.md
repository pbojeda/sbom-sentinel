# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- **Token expiry warnings** — add a `tokenExpiry` map in the config file (token name → `YYYY-MM-DD`) to receive proactive alerts before credentials expire. When any token is within 15 days of its configured expiry date sbom-sentinel logs a warning to the console and sends a notification via all enabled channels (Slack, email). Already-expired tokens are flagged as `EXPIRED`. The `--dry-run` command displays the remaining days for every configured token.
- **Per-platform private repository authentication** — repos can now be marked `"private": true`. Platform-specific tokens (`GITHUB_TOKEN`, `BITBUCKET_TOKEN`) take priority over the generic `GIT_TOKEN` fallback. sbom-sentinel validates that the required token is present at startup and fails with a clear error message before any clone is attempted.
- Support for Atlassian API tokens (the replacement for Bitbucket App Passwords since September 2025): set `BITBUCKET_TOKEN` to the API token and `BITBUCKET_USER` to your Atlassian account email.

---

## [0.1.0] — 2026-04-14

### Added

- `sbom-sentinel scan` command: clones repositories, generates CycloneDX 1.6 SBOMs with cdxgen, scans with Trivy, and produces consolidated reports
- `sbom-sentinel init` command: generates a starter `sbom-sentinel.config.json`
- `sbom-sentinel check` command: verifies that `git`, `cdxgen` and `trivy` are installed
- `sbom-sentinel --dry-run` flag: shows what would be done without executing
- `sbom-sentinel --repo <name>` flag: scans a single repository by name
- Support for six ecosystems: `node`, `swift`, `gradle`, `python`, `go`, `rust`
- Two SBOM generation modes per repository:
  - `cdxgen` (default): runs cdxgen with the repository type
  - `command`: runs a custom script and copies its output
- Finding deduplication by `vulnerability_id + package + installed_version`
- Report generation in JSON, HTML (standalone, no external CSS) and plain text
- Slack notifications via webhook using native Node 20 `fetch`
- Email notifications via SMTP using optional `nodemailer` dependency
- Notifications triggered by: CRITICAL/HIGH vulnerabilities (`onVulnerabilities`) and scan errors (`onErrors`)
- Token sanitization: git credentials are never written to logs or error messages
- Exit codes: `0` (ok), `1` (CRITICAL/HIGH found), `2` (scan errors)
- Configuration via `sbom-sentinel.config.json` and environment variables
- Environment variable priority over config file values
- Artifact naming convention: `{repo}__{branch}__{commitSha}__{timestamp}__{type}`
- Programmatic API: `scan()` and `loadConfig()` exported from the package root
- Full unit test suite with Vitest (121 tests, zero external tool calls in tests)
- Examples: Docker, Kubernetes CronJob, GitHub Actions, Bitbucket Pipelines

[Unreleased]: https://github.com/pbojeda/sbom-sentinel/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/pbojeda/sbom-sentinel/releases/tag/v0.1.0
