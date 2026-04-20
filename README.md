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
- Uploads HTML and JSON reports to **IBM Cloud Object Storage** or **Google Drive** and includes a direct link in notifications
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

# 3. Scaffold a new project with the interactive wizard
sbom-sentinel init                  # in the current directory
sbom-sentinel init ./my-audit-proj  # or create a new directory

# 4. Fill in your credentials (.env) and run:
sbom-sentinel scan --dry-run
sbom-sentinel scan
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

Run `sbom-sentinel init` to scaffold the full project interactively, or create `sbom-sentinel.config.json` manually:

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

#### Token resolution order (highest to lowest priority)

| Priority | Variable | Platform | Username |
|---|---|---|---|
| 1 | `BITBUCKET_TOKEN_<REPO_NAME>` | bitbucket.org | `x-token-auth` |
| 1 | `GITHUB_TOKEN_<REPO_NAME>` | github.com | `GITHUB_USER` |
| 1 | `GIT_TOKEN_<REPO_NAME>` | other hosts | `GIT_USER` |
| 2 | `BITBUCKET_TOKEN` | bitbucket.org | `BITBUCKET_USER` |
| 2 | `GITHUB_TOKEN` | github.com | `GITHUB_USER` |
| 3 | `GIT_TOKEN` | any | `GIT_USER` |

`<REPO_NAME>` is derived from the `name` field in the config: uppercased, with non-alphanumeric characters replaced by `_`. For example `my-backend` → `MY_BACKEND`.

#### Bitbucket (free accounts — per-repo tokens)

Free Bitbucket accounts cannot create workspace-level tokens. Create a **Repository HTTP access token** for each repo (repo → Settings → Security → Access tokens, permission: Repository Read):

```bash
# In your .env — one entry per private Bitbucket repo
BITBUCKET_TOKEN_MY_BACKEND=ATBB...
BITBUCKET_TOKEN_MY_FRONTEND=ATBB...
BITBUCKET_TOKEN_MY_SERVICE=ATBB...
```

No `BITBUCKET_USER` needed for per-repo tokens — the username is always `x-token-auth`.

#### Bitbucket (workspace token — paid plans)

If your plan supports workspace-level tokens, one token covers all repos in the workspace:

```bash
BITBUCKET_TOKEN=ATBB...
BITBUCKET_USER=x-token-auth
```

#### GitHub

A personal access token (classic or fine-grained with repository read access) works with the default `GITHUB_USER=x-token-auth`:

```bash
GITHUB_TOKEN=ghp_...
```

For per-repo GitHub tokens (fine-grained PATs scoped to a single repo):

```bash
GITHUB_TOKEN_MY_BACKEND=github_pat_...
```

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
| `GITHUB_TOKEN_<REPO>` | * | — | Per-repo GitHub token (highest priority for github.com repos) |
| `GITHUB_TOKEN` | * | — | Shared token for all github.com repositories |
| `GITHUB_USER` | No | `x-token-auth` | Username for GitHub token auth |
| `BITBUCKET_TOKEN_<REPO>` | * | — | Per-repo Bitbucket token; `<REPO>` is the uppercased repo name (e.g. `MY_BACKEND`) |
| `BITBUCKET_TOKEN` | * | — | Shared token for all bitbucket.org repositories |
| `BITBUCKET_USER` | No | `x-token-auth` | Username for shared Bitbucket token |
| `GIT_TOKEN_<REPO>` | * | — | Per-repo generic token for other hosts |
| `GIT_TOKEN` | * | — | Fallback token for any platform not covered above |
| `GIT_USER` | No | `x-token-auth` | Fallback git username |
| `SLACK_WEBHOOK_URL` | No | — | Slack incoming webhook URL |
| `SMTP_HOST` | No | — | SMTP server hostname |
| `SMTP_PORT` | No | `587` | SMTP port |
| `SMTP_USER` | No | — | SMTP username |
| `SMTP_PASS` | No | — | SMTP password |
| `EMAIL_FROM` | No | — | Sender address |
| `EMAIL_TO` | No | — | Comma-separated recipient addresses |
| `STORAGE_PROVIDER` | No | — | Enable persistent storage. Comma-separated list: `ibm-cos`, `google-drive`, or both |
| `IBM_COS_ENDPOINT` | * | — | IBM COS S3 endpoint URL |
| `IBM_COS_BUCKET` | * | — | IBM COS bucket name |
| `IBM_COS_ACCESS_KEY_ID` | * | — | IBM COS HMAC access key ID |
| `IBM_COS_SECRET_ACCESS_KEY` | * | — | IBM COS HMAC secret access key |
| `IBM_COS_REGION` | No | `us-south` | IBM COS region |
| `IBM_COS_PUBLIC_URL` | No | — | Virtual-hosted public base URL for IBM COS (bucket name in domain) |
| `GOOGLE_DRIVE_CREDENTIALS` | * | — | Path to `service-account.json` or inline JSON string |
| `GOOGLE_DRIVE_FOLDER_ID` | No | — | Google Drive folder ID for uploaded files |
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

#### `init` — Scaffold a new project

Interactive wizard that asks questions and generates a complete, tailored project.

```bash
sbom-sentinel init                  # scaffold in the current directory
sbom-sentinel init ./my-audit-proj  # create a new directory and scaffold inside it
```

The wizard asks:

1. **Project name** — used as `manufacturer` in the config
2. **Repositories** — add as many as needed (name, clone URL, branch, type)
3. **Slack notifications** — yes/no
4. **Report storage** — `none`, `ibm-cos`, `google-drive`, or `both`
5. **Kubernetes manifests** — yes/no (namespace, schedule, image)

Generated files:
- `sbom-sentinel.config.json` — fully populated with your repos and settings
- `.env.example` — only the credential vars relevant to your platforms and storage choices
- `.gitignore` — pre-configured to exclude `.env` and `artifacts/`
- `kubernetes/cronjob.yaml`, `configmap.yaml`, `secrets.yaml` — if Kubernetes was selected

Platform credential sections are derived automatically from each repo's clone URL — a project with both GitHub and Bitbucket repos gets both credential sections.

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

**Slack message format:**
- Status headline (CRITICAL/HIGH DETECTED or SCAN ERRORS)
- Global totals by severity
- Affected repositories with CRITICAL and HIGH counts
- Failed repositories with error message
- Optional link to the full HTML report (when `reportUrl` is set — see persistent storage)

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

## Persistent report storage

After each scan, sbom-sentinel can automatically upload the HTML and JSON summary reports to a cloud storage provider. The public URL is appended to Slack and email notifications as a **"View full report"** link.

Both providers are **optional dependencies** — the base install is unaffected. Install only the package you need.

### IBM Cloud Object Storage (S3-compatible)

Install the AWS SDK v3:

```bash
npm install @aws-sdk/client-s3
```

Configure:

| Variable | Required | Description |
|---|---|---|
| `STORAGE_PROVIDER` | Yes | Set to `ibm-cos` (or `ibm-cos,google-drive` for both) |
| `IBM_COS_ENDPOINT` | Yes | S3 endpoint URL (e.g. `https://s3.eu-de.cloud-object-storage.appdomain.cloud`) |
| `IBM_COS_BUCKET` | Yes | Target bucket name |
| `IBM_COS_ACCESS_KEY_ID` | Yes | HMAC access key ID |
| `IBM_COS_SECRET_ACCESS_KEY` | Yes | HMAC secret access key |
| `IBM_COS_REGION` | No | Region (default: `us-south`) |
| `IBM_COS_PUBLIC_URL` | No | Virtual-hosted public base URL (e.g. `https://my-bucket.s3.eu-de.cloud-object-storage.appdomain.cloud`). When set, the bucket name is omitted from the object path. |

**IBM Cloud setup:**
1. Create a bucket in [IBM Cloud Object Storage](https://cloud.ibm.com/objectstorage/)
2. Under **Access policies → Public access**, enable **Object Reader** to allow anonymous reads by URL
3. Create a **Service credential** with **Writer** role and enable **HMAC credentials**
4. Use the generated `access_key_id` and `secret_access_key` as your env vars

```bash
STORAGE_PROVIDER=ibm-cos
IBM_COS_ENDPOINT=https://s3.eu-de.cloud-object-storage.appdomain.cloud
IBM_COS_BUCKET=sbom-sentinel-reports
IBM_COS_ACCESS_KEY_ID=<hmac_access_key_id>
IBM_COS_SECRET_ACCESS_KEY=<hmac_secret_access_key>
IBM_COS_REGION=eu-de
# optional virtual-hosted public URL (bucket name is in the domain):
IBM_COS_PUBLIC_URL=https://sbom-sentinel-reports.s3.eu-de.cloud-object-storage.appdomain.cloud
```

### Google Drive

Install the Google APIs client:

```bash
npm install googleapis
```

Configure:

| Variable | Required | Description |
|---|---|---|
| `STORAGE_PROVIDER` | Yes | Set to `google-drive` (or `ibm-cos,google-drive` for both) |
| `GOOGLE_DRIVE_CREDENTIALS` | Yes | Path to a `service-account.json` file, or the JSON content as an inline string |
| `GOOGLE_DRIVE_FOLDER_ID` | No | Target folder ID. Defaults to the service account's root drive. |

Reports are organised under a `YYYY-MM-DD/` subfolder inside `GOOGLE_DRIVE_FOLDER_ID` (or Drive root). The subfolder is created automatically on first use and reused on subsequent runs the same day.

**Google Cloud setup:**
1. In [Google Cloud Console](https://console.cloud.google.com), create a service account
2. Enable the **Google Drive API** and grant the `drive` scope
3. Download the service account key as `service-account.json`
4. Share the target Drive folder with the service account email as **Editor**

```bash
STORAGE_PROVIDER=google-drive

# Local / Docker: path to a service-account.json file
GOOGLE_DRIVE_CREDENTIALS=/path/to/service-account.json

# Kubernetes: inline JSON (no file mount needed — store minified JSON as a Secret value)
# GOOGLE_DRIVE_CREDENTIALS={"type":"service_account","client_email":"sa@project.iam.gserviceaccount.com","private_key":"..."}

GOOGLE_DRIVE_FOLDER_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs
```

> **Google Workspace organisations:** If you see `Service Accounts do not have storage quota`, your org restricts service accounts from using personal Drive storage. Fix: create a **Shared Drive** (formerly Team Drive), add the service account email as a **Contributor**, and use the Shared Drive ID (or a folder within it) as `GOOGLE_DRIVE_FOLDER_ID`. Shared Drives have their own storage quota independent of user accounts.

### Storage behaviour

- **Multi-provider**: set `STORAGE_PROVIDER=ibm-cos,google-drive` to upload to both simultaneously. The first successful URL is used for notifications.
- **IBM COS**: reports are uploaded to `reports/<filename>` within the configured bucket
- **Google Drive**: reports are uploaded to `YYYY-MM-DD/<filename>` inside the configured folder (or root)
- The HTML report URL is appended to Slack and email notifications as a "View full report" link
- If the optional package is not installed, sbom-sentinel warns and continues without uploading
- If the upload fails for any reason, a warning is logged and the scan continues without a report URL
- If `STORAGE_PROVIDER` is set but required credentials are missing, the scan aborts at startup with a clear error listing the missing variables

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
          # imagePullSecrets:                   # uncomment if using a private container registry
          #   - name: registry-pull-secret
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
              emptyDir: {}    # reports are uploaded to cloud storage; no persistent volume needed
```

Secrets (`GIT_TOKEN`, `SLACK_WEBHOOK_URL`, …) should be stored in a Kubernetes `Secret` named `sbom-sentinel-secrets`.

> **Private container registries (ICR, ECR, GCR):** If your image is in a private registry, create an image pull secret and uncomment `imagePullSecrets` above. Example for IBM Container Registry:
> ```bash
> kubectl create secret docker-registry registry-pull-secret \
>   --namespace <your-namespace> \
>   --docker-server=de.icr.io \
>   --docker-username=iamapikey \
>   --docker-password=<IBM_API_KEY>
> ```

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
