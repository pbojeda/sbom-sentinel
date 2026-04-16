# CLAUDE.md — sbom-sentinel

## Project summary

`sbom-sentinel` is an open-source CLI tool in TypeScript that automates SBOM (Software Bill of Materials) generation in CycloneDX format and vulnerability scanning for multiple Git repositories. It runs as a scheduled task (Kubernetes CronJob, local cron, CI/CD) and notifies via Slack and email when critical or high vulnerabilities are detected, or when the process itself fails.

- **Author:** pbojeda
- **License:** MIT
- **npm:** `sbom-sentinel`
- **Node.js:** >= 20

## Architecture

```
src/
├── cli.ts       # CLI entry point — argument parsing, command dispatch
├── config.ts    # Config loading (.json + env vars), validation, CLI args
├── git.ts       # HTTPS repo cloning with token auth (sanitises credentials in logs)
├── index.ts     # Public programmatic API exports
├── logger.ts    # Zero-dependency coloured logger (log/ok/warn/err/dim)
├── notify.ts    # Slack (native fetch) + email (nodemailer optional) notifications
├── report.ts    # GlobalSummary builder + JSON/HTML/TXT report generators
├── runner.ts    # Main orchestrator: clone → sbom → scan → report → notify
├── sbom.ts      # SBOM generation via cdxgen (or custom command)
├── scanner.ts   # Trivy sbom scanning, finding extraction, deduplication
└── types.ts     # All shared TypeScript types
```

External dependencies (system binaries — not npm packages):
- `git` — cloning repositories
- `cdxgen` — SBOM generation (`npm install -g @cyclonedx/cdxgen`)
- `trivy` — vulnerability scanning (`https://trivy.dev`)

## Key conventions

- **No unnecessary npm deps.** Logger, CLI parser, and HTTP calls (Slack) use Node 20 built-ins only. Optional dependencies: `nodemailer` (email), `@aws-sdk/client-s3` (IBM COS storage), `googleapis` (Google Drive storage). All three are optional — the base install is unaffected when they are absent.
- **Credentials never appear in logs or artefacts.** `git.ts` sanitises clone URLs before any output.
- **`execSync`** from `node:child_process` for all external tool calls. Each module that shells out accepts an exec function parameter to allow easy mocking in tests.
- **Strict TypeScript** (`strict: true`, `module: Node16`). All code must compile cleanly with `npm run lint`.
- **English only** in log messages, reports, and user-facing output (public international project).

## Config file (`sbom-sentinel.config.json`)

Non-sensitive configuration lives here. Secrets (tokens, SMTP passwords) are always env vars. See `.env.example` for the full list of supported env vars.

Priority order: env vars → CLI flags → config file → defaults.

## Artefact naming

```
{outputDir}/
├── {YYYY-MM-DD}/
│   ├── {repo}__{branch}__{commitSha}__{timestamp}__bom.cdx.json
│   └── {repo}__{branch}__{commitSha}__{timestamp}__trivy.json
└── reports/
    ├── summary__{YYYY-MM-DD}.json
    ├── summary__{YYYY-MM-DD}.html
    └── summary__{YYYY-MM-DD}.txt
```

## Testing

```bash
npm test              # run all unit tests (vitest)
npm run test:coverage # with coverage report
npm run lint          # tsc --noEmit type check
npm run build         # compile to dist/
```

Tests mock all external calls (`execSync`, `fetch`). Fixtures live in `tests/fixtures/`.

## Development rules

- Do not add dependencies beyond what already exists in `package.json`.
- Do not add error handling for impossible scenarios; trust TypeScript and internal guarantees.
- Do not add comments unless the logic is non-obvious.
- HTML reports must be fully self-contained (no external CSS/JS/CDN).
- File paths must work on both macOS and Linux.
