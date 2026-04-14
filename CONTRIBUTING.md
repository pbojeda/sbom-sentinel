# Contributing to sbom-sentinel

Thank you for taking the time to contribute. This document covers how to report issues, propose changes, and submit pull requests.

---

## Table of contents

- [Reporting issues](#reporting-issues)
- [Proposing changes](#proposing-changes)
- [Development setup](#development-setup)
- [Project structure](#project-structure)
- [Coding guidelines](#coding-guidelines)
- [Testing](#testing)
- [Pull request process](#pull-request-process)
- [Security](#security)

---

## Reporting issues

Use [GitHub Issues](https://github.com/pbojeda/sbom-sentinel/issues) to report bugs or request features.

**For bugs**, please include:
- sbom-sentinel version (`sbom-sentinel --version`)
- Node.js version (`node --version`)
- cdxgen version (`cdxgen --version`)
- Trivy version (`trivy --version`)
- Operating system
- The relevant section of your `sbom-sentinel.config.json` (with any sensitive values removed)
- The full error output (with tokens and credentials redacted)

**For feature requests**, describe the use case and the expected behavior.

---

## Proposing changes

Before opening a pull request for a significant change, please open an issue first to discuss the approach. Small fixes (typos, docs, minor bugs) can go straight to a PR.

---

## Development setup

**Requirements:**
- Node.js ≥ 20
- npm ≥ 10

**Clone and install:**

```bash
git clone https://github.com/pbojeda/sbom-sentinel.git
cd sbom-sentinel
npm install
```

**Run tests:**

```bash
npm test           # run all tests once
npm run test:watch # watch mode
npm run test:coverage
```

**Type-check:**

```bash
npm run lint       # tsc --noEmit
```

**Build:**

```bash
npm run build      # compiles src/ → dist/
npm run clean      # removes dist/
```

You do **not** need cdxgen or Trivy installed for development — all shell commands are mocked in the unit test suite.

---

## Project structure

```
src/
  types.ts     Shared TypeScript types
  logger.ts    Colorized logger + execSync wrapper
  config.ts    Config loading, .env parsing, CLI arg parsing
  git.ts       Repository cloning with credential sanitization
  sbom.ts      SBOM generation via cdxgen or custom command
  scanner.ts   Trivy scanning, finding extraction, deduplication
  report.ts    GlobalSummary builder, JSON/HTML/TXT report generators
  notify.ts    Slack and email notifications
  runner.ts    Orchestrator: ties all modules together
  cli.ts       CLI entry point (bin)
  index.ts     Public programmatic API

tests/
  unit/        Unit tests (one file per src module)
  fixtures/    Sample SBOM, Trivy output, and config for tests
```

---

## Coding guidelines

- **Language:** TypeScript with `strict: true`. All code must compile without errors.
- **Module system:** ES modules (`"type": "module"`, Node16 resolution). Use `.js` extensions in imports.
- **No unnecessary dependencies.** The runtime has zero npm dependencies (nodemailer is optional). Use Node built-ins.
- **No external HTTP in runtime:** Use native `fetch` (Node 20). No axios.
- **No dotenv:** The `.env` loader in `config.ts` is a minimal custom implementation.
- **Credential safety:** Never log tokens, passwords, or full clone URLs. Any string containing credentials must be passed through `makeSanitizer` before being written to logs or error messages.
- **Error handling:** Module functions throw on failure; the runner catches per-repo errors so one failure does not abort the full scan. Notification functions never throw.
- **Testability:** Every module that calls `execSync` must receive the exec function via the `run()` wrapper from `logger.ts`, which accepts a `sanitize` parameter and is mockable via `vi.mock`.
- **English only:** Log messages, report content, error messages, and code comments are in English.
- **No console.log:** Use the functions from `logger.ts` (`log`, `ok`, `warn`, `err`, `dim`).

---

## Testing

- Tests live in `tests/unit/` with one file per source module.
- External tools (cdxgen, trivy, git) are **never called** in unit tests. Mock `../../src/logger.js` to intercept `run()` calls.
- Fixtures in `tests/fixtures/` provide real-world sample data (SBOM, Trivy output, config).
- Every new module must have unit tests before the PR is merged.
- Aim to keep branch coverage above 80% for the modules that have tests.

```bash
npm run test:coverage   # check coverage before submitting
```

---

## Pull request process

1. Fork the repository and create a feature branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
2. Make your changes, add or update tests.
3. Ensure the full suite passes and there are no TypeScript errors:
   ```bash
   npm run lint && npm test
   ```
4. Update `CHANGELOG.md` — add your change under `[Unreleased]`.
5. Open a pull request against `main` with a clear description of what and why.
6. A maintainer will review and may request changes before merging.

---

## Security

If you discover a security vulnerability, **do not open a public issue**. Please report it privately via [GitHub Security Advisories](https://github.com/pbojeda/sbom-sentinel/security/advisories/new) or by emailing the maintainer directly.

See also: [credential safety](#coding-guidelines) — the tool handles git tokens and SMTP passwords; any change to those code paths requires extra scrutiny.
