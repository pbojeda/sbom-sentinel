---
name: health-check
description: "Quick project health scan. Invoke with: 'health check', 'project health', or 'health'. Verifies tests, build, specs sync, secrets, and documentation freshness."
---

# Health Check Skill

Run a fast, systematic health scan across the project. Useful before starting new work, after merging, or when something feels off.

## Command

| Command | Action |
|---------|--------|
| `health` | Run full health check |

## Checks

Run all checks in order. For each, report PASS or FAIL with details.

### 1. Tests

```bash
npm test
```

FAIL if any test fails or the command exits non-zero.

### 2. Build

```bash
npm run build
```

FAIL if build errors. SKIP if no build script exists.

### 3. Type Check

```bash
npx tsc --noEmit
```

FAIL if type errors. SKIP if no `tsconfig.json`.

### 4. Critical TODOs

Search codebase for `TODO`, `FIXME`, `HACK`, `XXX` in source files (exclude `node_modules`, `dist`, `.git`).

WARN if any found. List file:line for each.

### 5. Spec Sync

- Compare routes registered in code vs endpoints in `docs/specs/api-spec.yaml`
- Compare exported components vs `docs/specs/ui-components.md`
- FAIL if mismatches found. SKIP if spec files don't exist.

### 6. Secrets Scan

Search for patterns that suggest leaked secrets:
- API keys, tokens, passwords in source files
- `.env` files tracked by git (`git ls-files '*.env'`)
- Hardcoded `localhost` URLs with ports (warn only)

FAIL if secrets found. WARN for localhost URLs.

### 7. Environment

- Check `.env.example` exists and lists all variables referenced in code
- WARN if `.env.example` is missing or incomplete

### 8. Tracker Coherence

- Read `docs/project_notes/product-tracker.md`
- Check Active Session is clean (no stale in-progress work)
- WARN if tracker looks stale or inconsistent

## Output Format

```
## Project Health Report

| # | Check | Status | Details |
|---|-------|--------|---------|
| 1 | Tests | PASS | 47 tests passing |
| 2 | Build | PASS | Clean |
| 3 | Types | PASS | No errors |
| 4 | TODOs | WARN | 3 found (see below) |
| 5 | Specs | PASS | Routes match |
| 6 | Secrets | PASS | None found |
| 7 | Env | PASS | .env.example up to date |
| 8 | Tracker | WARN | Active session not empty |

**Overall: HEALTHY / NEEDS ATTENTION / UNHEALTHY**

### Details
[Expand on any FAIL or WARN items]
```

**HEALTHY** = all PASS (WARNs ok). **NEEDS ATTENTION** = WARNs present. **UNHEALTHY** = any FAIL.

## Rules

- Run checks in order — stop early if tests or build fail (later checks may be unreliable)
- Be specific about failures — include file paths, line numbers, exact errors
- Don't fix anything — only report. The user decides what to act on
- Keep output concise — details only for non-PASS items
