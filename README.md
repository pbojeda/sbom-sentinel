# sbom-sentinel

[![npm version](https://badge.fury.io/js/sbom-sentinel.svg)](https://www.npmjs.com/package/sbom-sentinel)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/pbojeda/sbom-sentinel/actions/workflows/ci.yml/badge.svg)](https://github.com/pbojeda/sbom-sentinel/actions/workflows/ci.yml)
[![Node >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

Automated SBOM generation and vulnerability scanning for multiple Git repositories. Generates CycloneDX 1.6 SBOMs with cdxgen, scans with Trivy, and notifies via Slack or email when critical or high vulnerabilities are found.

Designed to run as a scheduled task (Kubernetes CronJob, cron, CI/CD pipeline) across any number of repositories — GitHub, GitLab, Bitbucket or any HTTPS-accessible Git host.

---

## Features

- Clones multiple repositories and generates CycloneDX 1.6 SBOMs with [cdxgen](https://github.com/CycloneDX/cdxgen)
- Scans each SBOM with [Trivy](https://trivy.dev) and extracts structured findings
- Deduplicates findings across targets within each repository
- Consolidates results across all repositories into a single report
- Generates reports in **JSON**, **HTML** (standalone, no external CSS) and **plain text**
- Notifies via **Slack webhook** and/or **email** (SMTP) on CRITICAL/HIGH findings or scan errors
- Supports **private repositories** on GitHub and Bitbucket with per-platform token validation at startup
- Warns 15 days before a configured token expires and sends a notification via all enabled channels
- Supports custom SBOM generation commands per repository (`mode: "command"`)
- Zero npm runtime dependencies — native Node 20 fetch, no axios, no dotenv
- Supports `node`, `swift`, `gradle`, `python`, `go`, `rust` ecosystems via cdxgen

---

## Quick start

```bash
# 1. Install prerequisites (see Prerequisites section)
npm install -g @cyclonedx/cdxgen   # or use npx
brew install aquasecurity/trivy/trivy

# 2. Install sbom-sentinel
npm install -g sbom-sentinel

# 3. Create a starter config
sbom-sentinel init

# 4. Edit sbom-sentinel.config.json and add your repos, then:
GIT_TOKEN=your-token sbom-sentinel scan
```

---

## Prerequisites

sbom-sentinel requires these tools to be installed and available in `PATH`:

| Tool | Install | Purpose |
|---|---|---|
| **Node.js ≥ 20** | [nodejs.org](https://nodejs.org) | Runtime |
| **git** | [git-scm.com](https://git-scm.com/downloads) | Clone repositories |
| **cdxgen** | `npm install -g @cyclonedx/cdxgen` | Generate CycloneDX SBOMs |
| **trivy** | [trivy.dev](https://trivy.dev/latest/getting-started/installation/) | Scan SBOMs for vulnerabilities |

Verify that everything is in place:

```bash
sbom-sentinel check
```

---

## Installation

**Global install (recommended for CLI use):**

```bash
npm install -g sbom-sentinel
sbom-sentinel --version
```

**One-off execution without installing:**

```bash
npx sbom-sentinel scan
```

**As a library in your Node.js project:**

```bash
npm install sbom-sentinel
```

```typescript
import { scan, loadConfig } from 'sbom-sentinel';

const config = loadConfig(['scan'], process.cwd());
const { summary, exitCode } = await scan(config);
```

---

## Configuration

### Config file

Create `sbom-sentinel.config.json` in your working directory (or run `sbom-sentinel init`):

```json
{
  "$schema": "https://raw.githubusercontent.com/pbojeda/sbom-sentinel/main/schema.json",
  "manufacturer": "My Company, S.L.",
  "outputDir": "./artifacts",
  "notifications": {
    "onVulnerabilities": true,
    "onErrors": true,
    "slack": { "enabled": true },
    "email": { "enabled": false }
  },
  "repos": [
    {
      "name": "my-backend",
      "cloneUrl": "https://github.com/myorg/my-backend.git",
      "branch": "main",
      "type": "node"
    },
    {
      "name": "my-library",
      "cloneUrl": "https://github.com/myorg/my-library.git",
      "branch": "main",
      "type": "node",
      "mode": "command",
      "sbomCommand": "npm ci && npm run sbom",
      "sbomOutput": "sbom/bom.json"
    },
    {
      "name": "my-ios-app",
      "cloneUrl": "https://github.com/myorg/my-ios-app.git",
      "branch": "main",
      "type": "swift",
      "enabled": false,
      "notes": "Enable when Package.resolved is committed"
    }
  ]
}
```

#### Repository fields

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Unique identifier used in reports and artifact filenames |
| `cloneUrl` | Yes | HTTPS clone URL |
| `branch` | Yes | Branch to clone |
| `type` | Yes | Ecosystem type: `node`, `swift`, `gradle`, `python`, `go`, `rust` |
| `mode` | No | `"cdxgen"` (default) or `"command"` (custom SBOM script) |
| `sbomCommand` | No | Shell command to generate the SBOM (required when `mode: "command"`) |
| `sbomOutput` | No | Path to the SBOM file produced by `sbomCommand` (default: `bom.json`) |
| `enabled` | No | Set to `false` to skip this repo without removing it from the config |
| `private` | No | Set to `true` if the repo requires authentication. sbom-sentinel validates that the appropriate token is set before starting the scan |
| `notes` | No | Free-text notes, ignored by the tool |

### Private repositories

Mark private repos with `"private": true`. sbom-sentinel validates that the appropriate token is set at startup — before any clone is attempted.

Platform-specific tokens take priority over the generic `GIT_TOKEN`:

| Platform | Token variable | User variable |
|---|---|---|
| github.com | `GITHUB_TOKEN` | `GITHUB_USER` (default: `x-token-auth`) |
| bitbucket.org | `BITBUCKET_TOKEN` | `BITBUCKET_USER` (default: `x-token-auth`) |
| Any other host | `GIT_TOKEN` | `GIT_USER` (default: `x-token-auth`) |

For Bitbucket, generate an **Atlassian API token** at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) and use your Atlassian account email as `BITBUCKET_USER`.

```bash
BITBUCKET_TOKEN=<atlassian-api-token>
BITBUCKET_USER=<your-atlassian-email>
```

For GitHub, a personal access token (classic or fine-grained with repository read access) works with the default `GITHUB_USER=x-token-auth`.

### Token expiry warnings

Tokens expire. Configure expiry dates so sbom-sentinel notifies you before they do:

```json
{
  "tokenExpiry": {
    "BITBUCKET_TOKEN": "2027-04-15",
    "GITHUB_TOKEN": "2027-06-01"
  }
}
```

**Behaviour:**
- If a token expires within **15 days**: logs a warning to the console and sends a notification via all configured channels (Slack, email)
- If a token has **already expired**: same — the notification marks it as `EXPIRED` with a prompt to renew
- Tokens beyond the 15-day window: shown in `--dry-run` output with days remaining, no notification sent
- Invalid date strings are silently skipped

The `--dry-run` command shows the status of all configured token expiry dates without executing any scans.

### Environment variables

All credentials and sensitive settings are passed via environment variables. The config file contains only non-sensitive configuration.

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_TOKEN` | * | — | Token for github.com repositories (takes priority over `GIT_TOKEN`) |
| `GITHUB_USER` | No | `x-token-auth` | Username for GitHub token auth |
| `BITBUCKET_TOKEN` | * | — | Token for bitbucket.org repositories (takes priority over `GIT_TOKEN`) |
| `BITBUCKET_USER` | * | `x-token-auth` | Username for Bitbucket token auth. Use your Atlassian email for API tokens |
| `GIT_TOKEN` | * | — | Fallback token for any platform not covered above |
| `GIT_USER` | No | `x-token-auth` | Fallback git username |
| `SLACK_WEBHOOK_URL` | No | — | Slack incoming webhook URL |
| `SMTP_HOST` | No | — | SMTP server hostname |
| `SMTP_PORT` | No | `587` | SMTP port |
| `SMTP_USER` | No | — | SMTP username |
| `SMTP_PASS` | No | — | SMTP password |
| `EMAIL_FROM` | No | — | Sender address |
| `EMAIL_TO` | No | — | Comma-separated recipient addresses |
| `SENTINEL_CONFIG` | No | `./sbom-sentinel.config.json` | Path to the config file |
| `SENTINEL_OUTPUT_DIR` | No | `./artifacts` | Output directory (overrides `outputDir` in config) |
| `SENTINEL_REPO` | No | — | Scan only the named repository (overrides `--repo`) |
| `LOG_LEVEL` | No | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |

\* At least one token must be set for any private repository in the config.

### Configuration priority

Environment variables always win:

1. **Environment variables** ← highest priority
2. **CLI flags** (`--config`, `--repo`, `--dry-run`)
3. **`sbom-sentinel.config.json`**
4. **Defaults**

---

## Usage

```
sbom-sentinel <command> [options]
```

### Commands

#### `scan` — Run the full pipeline

```bash
# Full scan using default config
GIT_TOKEN=ghp_xxx sbom-sentinel scan

# Preview what would happen without executing anything
sbom-sentinel scan --dry-run

# Scan a single repository by name
sbom-sentinel scan --repo my-backend

# Use a custom config file
sbom-sentinel scan --config /path/to/my-config.json
```

#### `init` — Generate a starter config

```bash
sbom-sentinel init
# Creates ./sbom-sentinel.config.json in the current directory
```

#### `check` — Verify external tools

```bash
sbom-sentinel check
# Checks that git, cdxgen and trivy are installed and in PATH
```

#### Global flags

```bash
sbom-sentinel --version   # Print version
sbom-sentinel --help      # Print usage
```

### Exit codes

| Code | Meaning |
|---|---|
| `0` | All repositories scanned, no CRITICAL or HIGH vulnerabilities |
| `1` | CRITICAL or HIGH vulnerabilities found (all scans completed) |
| `2` | One or more repositories could not be scanned (partial results) |

---

## Output

### Directory structure

```
{outputDir}/
├── {YYYY-MM-DD}/
│   ├── {repo}__{branch}__{commitSha}__{timestamp}__bom.cdx.json
│   ├── {repo}__{branch}__{commitSha}__{timestamp}__trivy.json
│   └── ...
└── reports/
    ├── summary__{YYYY-MM-DD}.json
    ├── summary__{YYYY-MM-DD}.html
    └── summary__{YYYY-MM-DD}.txt
```

**Filename conventions:**
- `commitSha` — 7-character short SHA of the cloned commit
- `timestamp` — UTC timestamp in `YYYYMMDDTHHMMSSz` format
- Slashes in branch names are replaced with `-` (e.g. `feature/auth` → `feature-auth`)

### Report formats

| Format | Content |
|---|---|
| **JSON** | Machine-readable `GlobalSummary` object — useful for post-processing or feeding into other tools |
| **HTML** | Standalone report with status banner, severity badges, per-repo table, and CVE details with links — no external CSS/JS required |
| **TXT** | Plain text summary suitable for Slack messages, email bodies, or terminal review |

---

## Notifications

### Slack

1. Create an [Incoming Webhook](https://api.slack.com/messaging/webhooks) in your Slack workspace.
2. Set the `SLACK_WEBHOOK_URL` environment variable.
3. Enable Slack in the config:

```json
"notifications": {
  "onVulnerabilities": true,
  "onErrors": true,
  "slack": { "enabled": true }
}
```

sbom-sentinel uses Node 20's native `fetch` — no extra dependencies.

### Email (SMTP)

Email requires the optional `nodemailer` package:

```bash
npm install nodemailer
```

Then configure:

```json
"notifications": {
  "email": { "enabled": true }
}
```

```bash
export SMTP_HOST=smtp.example.com
export SMTP_PORT=587
export SMTP_USER=alerts@example.com
export SMTP_PASS=secret
export EMAIL_FROM=alerts@example.com
export EMAIL_TO=security@example.com,devops@example.com
```

---

## Deployment

### Docker

```dockerfile
FROM node:20-alpine

RUN apk add --no-cache git bash curl

# cdxgen
RUN npm install -g @cyclonedx/cdxgen@11

# Trivy
RUN curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh \
    | sh -s -- -b /usr/local/bin

# sbom-sentinel
RUN npm install -g sbom-sentinel

ENTRYPOINT ["sbom-sentinel"]
CMD ["scan"]
```

```bash
docker build -t sbom-sentinel .
docker run --rm \
  -e GIT_TOKEN="$GIT_TOKEN" \
  -e SLACK_WEBHOOK_URL="$SLACK_WEBHOOK_URL" \
  -v "$(pwd)/sbom-sentinel.config.json:/app/sbom-sentinel.config.json:ro" \
  -v "$(pwd)/artifacts:/app/artifacts" \
  -w /app \
  sbom-sentinel scan
```

### Kubernetes CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: sbom-sentinel
  namespace: security
spec:
  schedule: "0 2 * * *"        # 02:00 UTC daily
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 7
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 1
      activeDeadlineSeconds: 3600
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: sentinel
              image: ghcr.io/pbojeda/sbom-sentinel:latest
              args: ["scan"]
              envFrom:
                - secretRef:
                    name: sbom-sentinel-secrets
              volumeMounts:
                - name: config
                  mountPath: /app/sbom-sentinel.config.json
                  subPath: sbom-sentinel.config.json
                - name: output
                  mountPath: /app/artifacts
          volumes:
            - name: config
              configMap:
                name: sbom-sentinel-config
            - name: output
              persistentVolumeClaim:
                claimName: sbom-sentinel-output
```

Secrets (`GIT_TOKEN`, `SLACK_WEBHOOK_URL`, …) should be stored in a Kubernetes `Secret` named `sbom-sentinel-secrets`.

### GitHub Actions

```yaml
# .github/workflows/sbom-scan.yml
name: SBOM Vulnerability Scan

on:
  schedule:
    - cron: '0 2 * * *'   # 02:00 UTC daily
  workflow_dispatch:

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Trivy
        run: |
          curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh \
            | sh -s -- -b /usr/local/bin

      - name: Install cdxgen and sbom-sentinel
        run: npm install -g @cyclonedx/cdxgen sbom-sentinel

      - name: Run scan
        env:
          GIT_TOKEN: ${{ secrets.GIT_TOKEN }}
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
        run: sbom-sentinel scan

      - name: Upload reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: sbom-reports
          path: artifacts/reports/
```

### Bitbucket Pipelines

```yaml
# bitbucket-pipelines.yml
pipelines:
  custom:
    sbom-scan:
      - step:
          name: SBOM Vulnerability Scan
          image: node:20
          script:
            - apt-get update && apt-get install -y curl
            - curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin
            - npm install -g @cyclonedx/cdxgen sbom-sentinel
            - sbom-sentinel scan
          artifacts:
            - artifacts/reports/**

  schedules:
    - cron: '0 2 * * *'
      branches:
        include:
          - main
      pipeline: custom.sbom-scan
```

---

## Supported ecosystems

sbom-sentinel passes the `type` field directly to cdxgen. The following types are supported:

| Type | Ecosystem | cdxgen analyses |
|---|---|---|
| `node` | Node.js / npm / yarn / pnpm | `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `node_modules/` |
| `swift` | Swift / iOS / macOS | `Package.resolved`, `Package.swift` |
| `gradle` | Java / Kotlin / Android | `build.gradle`, `build.gradle.kts`, `gradle.lockfile` |
| `python` | Python | `requirements.txt`, `Pipfile.lock`, `poetry.lock`, `pyproject.toml` |
| `go` | Go | `go.sum`, `go.mod` |
| `rust` | Rust | `Cargo.lock`, `Cargo.toml` |

For a full list of supported types and options, see the [cdxgen documentation](https://github.com/CycloneDX/cdxgen).

---

## Testing

```bash
# Run tests once
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Type-check without building
npm run lint
```

The test suite uses [Vitest](https://vitest.dev) with real fixtures in `tests/fixtures/`. External tools (cdxgen, trivy, git) are never called in unit tests — shell commands are mocked at the module level.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to submit issues, propose changes, and open pull requests.

---

## Technologies

| Technology | Version | Purpose |
|---|---|---|
| [Node.js](https://nodejs.org) | ≥ 20 | Runtime |
| [TypeScript](https://www.typescriptlang.org) | ≥ 5.0 | Language |
| [cdxgen](https://github.com/CycloneDX/cdxgen) | ≥ 11 | CycloneDX SBOM generation (external tool) |
| [Trivy](https://trivy.dev) | ≥ 0.50 | Vulnerability scanning (external tool) |
| [Vitest](https://vitest.dev) | ≥ 2.0 | Test framework |
| [nodemailer](https://nodemailer.com) | ≥ 8.0 | Email notifications (optional dependency) |

---

## License

MIT — see [LICENSE](LICENSE).

---

## Author

**pbojeda** — [github.com/pbojeda](https://github.com/pbojeda)
