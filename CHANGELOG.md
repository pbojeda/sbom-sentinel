# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [0.8.0] — 2026-04-27

### Added

- **Version column in HTML report** — The repositories table now includes a `Version` column populated from `metadata.component.version` in each scanned SBOM. The column only appears when at least one repository has a version (transparent for cdxgen mode where version is typically absent).
- **SBOM export CSV link in HTML report** — When the SBOM component export is enabled, a download link to the CSV file appears above the repositories table in the HTML report (relative link — works in both local filesystem and cloud storage contexts).

### Changed

- `schema.json`: The `path` field description now correctly states it is only used in `sbom-repository` mode. The incorrect "relative path within the repository for cdxgen" description has been removed (`path` is not read by the cdxgen SBOM generator).
- `README`: Fixed several accuracy issues identified in review — `check` command tool-skip behavior, `path` field description, `commitSha` artifact naming in `sbom-repository` mode, `init` wizard note for `sbom-repository`, mixed-mode tool requirements, microservice naming from filenames, "Zero required npm runtime dependencies" wording.

---

## [0.7.0] — 2026-04-24

### Added

- **`mode: "sbom-repository"` — sbom-repository detection mode** — A new repo mode that reads pre-generated SBOMs from a local SBOM repository directory (e.g. a clone of `i360-sbom-repository`) instead of cloning and generating SBOMs with cdxgen. When a repo is configured with `mode: "sbom-repository"`, sbom-sentinel:
  1. Scans the local directory specified in `"path"` for the most recent `sbom-DD-MM-YYYY` folder.
  2. Runs Trivy against each `*.json` file found in that folder.
  3. Produces one `RepoResult` entry per microservice SBOM, with `branch` and `commitSha` set to the detected folder date (e.g. `sbom-23-04-2026`).
  4. Reports and notifications work identically to normal mode.

  Example config entry:
  ```json
  {
    "name": "i360-sbom-repository",
    "cloneUrl": "",
    "branch": "master",
    "type": "node",
    "mode": "sbom-repository",
    "path": "/path/to/local/i360-sbom-repository"
  }
  ```

  When all repos use `mode: "sbom-repository"`, the `git` and `cdxgen` tool checks are skipped automatically (only `trivy` is required).

- **`findSbomRepositoryFolder()` exported** — New exported helper that finds the most recent `sbom-DD-MM-YYYY` folder in a given directory.

- **`checkExternalTools()` — optional `skipCdxgen` / `skipGit` parameters** — Both default to `false`. Set automatically when all repos use sbom-repository mode to avoid errors in environments that only have Trivy installed.

---

## [0.6.5] — 2026-04-22

### Added

- **Pre-existing SBOM detection** — Before generating an SBOM with cdxgen, sbom-sentinel now checks whether the cloned repository contains a `sbom/sbom-*.json` file. If found, that file is used directly and cdxgen is skipped. A message is logged: `Using pre-existing SBOM: sbom/sbom-v1.2.json (cdxgen skipped)`. The pre-existing file still goes through `validateSbom()` (must have a `components` array). When multiple files match, the first alphabetically is used. No configuration required — detection is automatic.

---

## [0.6.4] — 2026-04-21

### Added

- **SBOM component export CSV** — After all SBOMs are generated (and before vulnerability scanning), sbom-sentinel now writes a consolidated CSV to `{outputDir}/reports/{prefix}-YYYY_MM_DD.csv` containing every component from every scanned repository. Configurable via the new `sbomExport` key in `sbom-sentinel.config.json`:
  - `enabled` (default: `true`) — set to `false` to skip the export.
  - `filePrefix` (default: `"sbom-export"`) — prefix for the CSV filename. Only `[a-zA-Z0-9._-]` characters allowed (path-traversal safe).
  - The CSV is uploaded to all configured storage providers (IBM COS and/or Google Drive) alongside the HTML/JSON reports.
  - Columns: `repo, name, version, type, purl, licenses, group`. Licenses are joined with ` | ` when multiple licenses are present. Empty fields are empty strings (never `null` or `"N/A"`).
  - Non-fatal: if the export fails for any reason, vulnerability scanning continues and a warning is logged.
- **Two-phase runner** — `runner.ts` now runs in two explicit phases: (1) clone + SBOM generation for all repos, (2) SBOM export CSV, (3) vulnerability scanning. Temporary work directory is cleaned up after Phase 1, before scanning. This ensures SBOMs are persisted to `outputDir` before any Trivy scan and that export failures cannot block scans.
- **`SBOM export` line in `--dry-run` output** — shows the computed filename and prefix, or `disabled` when `sbomExport.enabled: false`.

---

## [0.6.3] — 2026-04-20

### Added

- **`init` wizard — Docker and CI file generation** — Two new questions at the end of the wizard:
  - "Generate Dockerfile and docker-compose.yml?" (default: no) — generates a production-ready `Dockerfile` (node:20-alpine + git, bash, curl, jq, cdxgen@11, Trivy, sbom-sentinel) and a `docker-compose.yml` with per-repo token env vars, SMTP vars, and storage vars activated or commented based on the chosen storage provider.
  - "Generate CI pipeline?" (choices: none/bitbucket/github-actions; default: auto-detected from repo URLs) — generates `bitbucket-pipelines.yml` (with `sbom-scan` and `sbom-scan-single` custom pipelines, per-repo token hints in the comment header) or `.github/workflows/sbom-sentinel.yml` (with per-repo token env vars, storage vars activated when configured, schedule inherited from the Kubernetes CronJob schedule if Kubernetes manifests were generated).

---

## [0.6.2] — 2026-04-20

### Fixed

- **`init` wizard — private repository flag missing** — The wizard never asked whether a repository is private, so `sbom-sentinel.config.json` was generated without `"private": true`. Without this flag, sbom-sentinel skips the fail-fast token validation at startup and only fails when `git clone` runs, producing a less actionable error. The wizard now asks "Private repository? (Y/n)" after the project type (defaults to yes), and only writes `"private": true` to the config when the user confirms.
- **`init` wizard — `kubernetes/cronjob.yaml` uses PVC when `emptyDir` is sufficient** — The generated CronJob provisioned a `PersistentVolumeClaim` for the artifacts volume. Since reports are uploaded to IBM COS or Google Drive after each scan, there is no reason to keep artifacts across pod restarts. `ReadWriteOnce` PVCs can also block pod rescheduling on IKS when a node is drained. The artifacts volume now uses `emptyDir: {}` in the generated template.
- **`init` wizard — `kubernetes/cronjob.yaml` missing `imagePullSecrets`** — Container images at `de.icr.io`, `us.icr.io`, ECR, GCR, and other private registries require an image pull secret to be specified in the pod spec. The generated CronJob now includes a commented-out `imagePullSecrets` block with instructions for creating the secret via `kubectl`.
- **`init` wizard — `GOOGLE_DRIVE_CREDENTIALS` guidance unsuitable for Kubernetes** — The generated `.env.example` and `kubernetes/secrets.yaml` suggested setting `GOOGLE_DRIVE_CREDENTIALS` to a file path. In a Kubernetes pod without a mounted service-account volume, a file path would crash the upload. Both files now document the inline JSON approach (supported by `storage.ts` alongside file paths) as the primary method for Kubernetes, with the file-path approach labeled as local/Docker.

---

## [0.6.1] — 2026-04-17

### Fixed

- **`init` wizard — HTTPS URL validation** — Clone URLs that are SSH-format (`git@github.com:org/repo.git`) or otherwise unparseable are now rejected immediately in the wizard with a clear message, preventing a hard crash in `buildCloneUrl()` at scan time. The prompt now reads "Clone URL (HTTPS)" for clarity.
- **`init` wizard — `secrets.yaml` invalid YAML** — `stringData:` followed by only commented-out lines parsed as `null` in YAML, causing `kubectl apply` to fail schema validation. All credential hints are now emitted as a comment block above the manifest and `stringData: {}` is used, producing a structurally valid (and directly applicable) Kubernetes Secret.
- **`init` wizard — `secrets.yaml` missing platform sections when no repos configured** — When the wizard was run without any repos, `k8sSecrets` only emitted the `GIT_TOKEN` (generic) section, while `.env.example` correctly showed all three platform sections (GitHub, Bitbucket, generic). Both files now use the same `noPlatforms` fallback logic: all platform sections are included when no repos are configured.
- **`init` wizard — `.gitignore` overwrite** — Running `sbom-sentinel init` in an existing project directory silently replaced the existing `.gitignore` with the minimal sentinel template, potentially exposing `node_modules/` or other local entries. Now: if `.gitignore` already exists, only the missing critical entries (`.env`, `artifacts/`) are appended; the rest of the file is preserved.
- **`init` wizard — spurious `cd .` step** — When initialising in the current directory (`sbom-sentinel init .`), the "Next steps" output incorrectly showed `1. cd .`. The `cd` step is now only shown when the target directory differs from the working directory.
- **`init` wizard — `askYesNo` silently coerced unrecognised input** — Typing `sure`, `1`, or a typo at a yes/no prompt returned `false` (like `n`) instead of re-prompting. `askYesNo` now loops on unrecognised input, matching the behaviour of `askChoice`.

---

## [0.6.0] — 2026-04-17

### Added

- **`sbom-sentinel init [directory]`** — Interactive project scaffolding wizard replaces the old static config dump.
  - Asks: project name, repositories (loop, add as many as needed), Slack notifications, report storage provider(s), and optionally Kubernetes manifests.
  - Generates a tailored set of files based on answers:
    - `sbom-sentinel.config.json` — fully populated config with all repos
    - `.env.example` — only the credential sections relevant to the project's platforms (GitHub, Bitbucket, or generic), Slack, and storage provider(s)
    - `.gitignore`
    - `kubernetes/cronjob.yaml`, `kubernetes/configmap.yaml`, `kubernetes/secrets.yaml` (optional)
  - Platform credential sections are derived automatically from each repo's clone URL using `detectPlatform()` — no separate "primary platform" question needed. Mixed-host projects (GitHub + Bitbucket) get both credential sections.
  - `StorageChoice = 'both'` maps to `STORAGE_PROVIDER=ibm-cos,google-drive` in all generated files — the runtime-expected comma-separated format is always used, never the wizard-only `both` value.
  - Per-repo token keys (`BITBUCKET_TOKEN_<NAME>`, `GITHUB_TOKEN_<NAME>`) are generated using the same `repoTokenEnvKey()` function the runner uses, ensuring consistency.
  - Accepts an optional target directory: `sbom-sentinel init ./my-project` creates the directory if it doesn't exist.

---

## [0.5.0] — 2026-04-16

### Added

- **Multi-provider storage** — `STORAGE_PROVIDER` now accepts a comma-separated list (e.g. `ibm-cos,google-drive`) to upload reports to both providers simultaneously. The first successful URL is used for notifications. Backward-compatible: existing single-value configs are unaffected.
- **Google Drive: date subfolder organisation** — reports are now uploaded into a `YYYY-MM-DD/` subfolder inside `GOOGLE_DRIVE_FOLDER_ID` (or Drive root). The subfolder is created on first use and reused on subsequent runs the same day, avoiding duplicates. Mirrors the local `artifacts/YYYY-MM-DD/` directory structure.
- **HTML report improvements**:
  - **Column reorder** — repository table now shows `Repo | CRITICAL | HIGH | Status | Branch | Commit | MEDIUM | LOW`, keeping the most actionable columns front and centre
  - **Zero counts as dash** — zero severity counts render as `-` instead of `0` to reduce visual noise
  - **Commit SHA tooltip** — SHA truncated to 7 characters in the table; full SHA shown on hover via `title` attribute
  - **Blast-radius line** — shows "N of M repositories affected · K scan errors" between the status banner and the severity badges
  - **Responsive tables** — both tables wrapped in `overflow-x: auto` for horizontal scroll on narrow viewports
  - **Complete dark mode** — badges, severity colours, blast-radius, status indicators, footer, links, and findings-meta are all correctly styled for `prefers-color-scheme: dark`
- **HTML report: XSS protection for CVE links** — `safeUrl()` validates that href URLs start with `http://` or `https://` (blocking `javascript:` and `data:` injection), combined with `esc()` (blocking attribute breakout via embedded quotes). Defence-in-depth: two independent protection layers.

### Fixed

- **Google Drive: Shared Drive support for Google Workspace organisations** — Added `supportsAllDrives: true` and `includeItemsFromAllDrives: true` to all Drive API calls. Service accounts in Google Workspace organisations that restrict personal Drive storage can now upload to a Shared Drive without the `Service Accounts do not have storage quota` error.

---

## [0.4.1] — 2026-04-16

### Fixed

- **IBM COS public URL construction** — `IBM_COS_PUBLIC_URL` set to an empty string (e.g. when the env var is declared but not set in a Kubernetes Secret) was incorrectly used as the URL base instead of falling through to `IBM_COS_ENDPOINT`. Changed `??` to `||` in `storage.ts` so both `undefined` and empty-string values correctly fall back to the endpoint. The upload itself was never affected — only the URL shown in notifications.

### Added

- **IBM Cloud IKS deployment files** — `deploy/kubernetes/cronjob.yaml`, `deploy/kubernetes/secrets.yaml`: production-ready CronJob manifest adapted for IBM Cloud IKS (namespace `i360`, ICR registry `de.icr.io`, `emptyDir` instead of PVC since reports are uploaded to IBM COS). Build images for IKS with `docker buildx build --platform linux/amd64`.

---

## [0.4.0] — 2026-04-16

### Added

- **Persistent report storage** — set `STORAGE_PROVIDER=ibm-cos` or `STORAGE_PROVIDER=google-drive` to automatically upload the HTML and JSON summary reports after each scan. The public URL is appended to Slack and email notifications as a "View full report" link.
  - **IBM COS** (`@aws-sdk/client-s3` optional dep): uploads via S3-compatible HMAC credentials. Required env vars: `IBM_COS_ENDPOINT`, `IBM_COS_BUCKET`, `IBM_COS_ACCESS_KEY_ID`, `IBM_COS_SECRET_ACCESS_KEY`. Optional: `IBM_COS_REGION` (default: `us-south`), `IBM_COS_PUBLIC_URL`.
  - **Google Drive** (`googleapis` optional dep): uploads via service account credentials. Required env var: `GOOGLE_DRIVE_CREDENTIALS` (path to `service-account.json` or inline JSON). Optional: `GOOGLE_DRIVE_FOLDER_ID`.
  - Both providers are optional dependencies — the base install is unaffected. Install the provider package only when needed.
  - Storage failures are non-fatal: a warning is logged and the scan continues; notifications are sent without a report URL.
  - Fail-fast validation: if `STORAGE_PROVIDER` is set but required credentials are missing, the scan aborts before any clone with a clear error message.
- **`Storage provider` line in `--dry-run` output** — shows the configured provider or `not set`.
- **`/cross-model-review` command** (`.claude/commands/cross-model-review.md`) — reusable skill to run a cross-model implementation plan review using Gemini CLI and Codex CLI in parallel.

---

## [0.3.0] — 2026-04-16

### Changed

- **Refactored Slack and email notification messages** — messages are now concise summaries instead of verbose per-finding detail. Slack shows: status headline, global severity totals, affected repositories with CRITICAL/HIGH counts, and failed repositories with error messages. Email uses the same structure as an exportable `buildEmailBody()` function (previously an unexported wrapper around the full text report).
- **Added `reportUrl` field to `NotifyConfig`** — when set, a "View full report" link is appended to both Slack and email messages. This field is the hook for the upcoming persistent storage feature (IBM COS / Google Drive) that will provide a public URL for the HTML report.
- **`buildEmailBody` is now exported** — available for testing and for custom notification integrations via the programmatic API.

---

## [0.2.1] — 2026-04-15

### Changed

- **Unique CVE count in findings section** — the Critical / High Findings table header now shows both the total number of findings and the number of unique CVE IDs (e.g. "8 findings · 3 unique CVE IDs"). This makes it clear when multiple installed versions of the same package are each affected by the same CVE.

---

## [0.2.0] — 2026-04-15

### Added

- **Token expiry warnings** — add a `tokenExpiry` map in the config file (token name → `YYYY-MM-DD`) to receive proactive alerts before credentials expire. When any token is within 15 days of its configured expiry date sbom-sentinel logs a warning to the console and sends a notification via all enabled channels (Slack, email). Already-expired tokens are flagged as `EXPIRED`. The `--dry-run` command displays the remaining days for every configured token.
- **Per-platform private repository authentication** — repos can now be marked `"private": true`. sbom-sentinel validates that the required token is present at startup and fails with a clear error message before any clone is attempted.
- **Per-repo token support** — `BITBUCKET_TOKEN_<REPO_NAME>`, `GITHUB_TOKEN_<REPO_NAME>`, and `GIT_TOKEN_<REPO_NAME>` allow a different token per repository. The `<REPO_NAME>` suffix is the uppercased `name` field from the config (hyphens and special characters replaced by `_`). Per-repo tokens take priority over the shared platform token, which falls back to `GIT_TOKEN`. This is the recommended approach for Bitbucket free accounts, which can only create repository-level HTTP access tokens.
- For Bitbucket per-repo tokens (created via repo → Settings → Security → Access tokens), the username is always `x-token-auth` — no `BITBUCKET_USER` needed.

### Fixed

- **Token sanitizer now covers URL-encoded tokens** — tokens containing `=` (and other characters encoded by `encodeURIComponent`) were visible in plain text in error log messages because the sanitizer regex only matched the raw token string. The sanitizer now also matches the URL-encoded form, ensuring credentials are never exposed in logs regardless of token format.
- **SBOM output path now resolved to absolute before invoking cdxgen** — when cdxgen ran with `cwd` set to the cloned repository directory, a relative output path was resolved against that directory instead of the project root, causing cdxgen to silently write nowhere and the SBOM to never be generated. The path is now converted to absolute with `path.resolve()` before being passed to cdxgen.

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

[Unreleased]: https://github.com/pbojeda/sbom-sentinel/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/pbojeda/sbom-sentinel/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/pbojeda/sbom-sentinel/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/pbojeda/sbom-sentinel/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/pbojeda/sbom-sentinel/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/pbojeda/sbom-sentinel/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/pbojeda/sbom-sentinel/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/pbojeda/sbom-sentinel/releases/tag/v0.1.0
