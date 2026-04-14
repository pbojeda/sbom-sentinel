Perform a comprehensive project review using multiple AI models in parallel. This is a 4-phase process designed for MVP milestones.

After /compact, re-invoke `/review-project` to resume. Completed work is preserved in /tmp/review-project-{project}/.

## Phase 0: Discovery

Detect project context without heavy file reading:

```bash
# Project type and SDD version
cat .sdd-version 2>/dev/null || echo "no .sdd-version"
head -30 docs/project_notes/key_facts.md 2>/dev/null

# Detect dominant source extensions (adapts to any JS/TS framework)
echo "=== Source extensions found ==="
find . -type f -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "*/.next/*" \
  -not -path "*/.nuxt/*" -not -path "*/build/*" -not -path "*/coverage/*" \
  \( -name "*.ts" -o -name "*.js" -o -name "*.tsx" -o -name "*.jsx" \
     -o -name "*.vue" -o -name "*.svelte" -o -name "*.astro" \
     -o -name "*.mjs" -o -name "*.cjs" \) \
  | head -100

# Scale
echo "Source files:" && find . -type f -not -path "*/node_modules/*" -not -path "*/dist/*" \
  -not -path "*/.next/*" -not -path "*/.nuxt/*" -not -path "*/build/*" \
  \( -name "*.ts" -o -name "*.js" -o -name "*.tsx" -o -name "*.jsx" \
     -o -name "*.vue" -o -name "*.svelte" -o -name "*.astro" \) | wc -l
echo "Test files:" && find . -type f -not -path "*/node_modules/*" \
  \( -name "*.test.*" -o -name "*.spec.*" \) | wc -l

# Detect stack signals
echo "=== Stack signals ==="
[ -f "package.json" ] && echo "package.json: exists" || echo "package.json: not found"
[ -d "prisma" ] && echo "prisma/: found"
find . -maxdepth 3 -name "*.prisma" -not -path "*/node_modules/*" 2>/dev/null | head -3
find . -maxdepth 3 -type d -name "models" -not -path "*/node_modules/*" 2>/dev/null | head -3
[ -f "tsconfig.json" ] && echo "tsconfig.json: exists"
[ -f "next.config.js" ] || [ -f "next.config.mjs" ] || [ -f "next.config.ts" ] && echo "Next.js project"
[ -f "nuxt.config.ts" ] || [ -f "nuxt.config.js" ] && echo "Nuxt project"
[ -f "vite.config.ts" ] || [ -f "vite.config.js" ] && echo "Vite project"
[ -f "angular.json" ] && echo "Angular project"
[ -f "svelte.config.js" ] && echo "Svelte project"
[ -f "astro.config.mjs" ] && echo "Astro project"

# Detect available CLIs (robust — test real invocation, not just path lookup)
if command -v gemini >/dev/null 2>&1; then
  GEMINI_TEST=$(echo "Reply OK" | gemini 2>&1 | head -1)
  echo "gemini: $GEMINI_TEST"
else
  echo "gemini: unavailable"
fi
if command -v codex >/dev/null 2>&1; then
  codex --version >/dev/null 2>&1 && echo "codex: available" || echo "codex: unavailable"
else
  echo "codex: unavailable"
fi
```

Create project-scoped working directory. Check for resume state:

```bash
REVIEW_DIR="/tmp/review-project-$(basename "$PWD")"
mkdir -p "$REVIEW_DIR"
echo "$REVIEW_DIR" > /tmp/.review-project-dir
cat "$REVIEW_DIR/progress.txt" 2>/dev/null || echo "No previous progress — starting fresh"
```

Use `$REVIEW_DIR` in all subsequent commands (or re-read from `/tmp/.review-project-dir` after /compact).

**Adapt domains by project type** (detected from key_facts.md, package.json, and stack signals above):
- Backend-only → skip frontend-specific checks in domain 2
- Frontend-only → skip domain 3 (Data Layer); domain 5 focuses on client-side security (XSS, CSP, token storage, route guards)
- Fullstack → all 6 domains

## Phase 1: Prepare Audit Context + External Digest + Launch

This phase has two sub-steps. Do NOT read the digest into your own context — assemble it entirely via bash.

### Step 1a: Generate Audit Context

Read **whichever of these files exist** to understand the project, then write a concise audit context to `$REVIEW_DIR/audit-context.md`:

**SDD project docs** (created by both `create-sdd-project` and `--init`):
- `docs/project_notes/key_facts.md` — stack, architecture, components
- `docs/project_notes/decisions.md` — ADRs and rationale
- `docs/specs/api-spec.yaml` or `docs/specs/api-spec.json` (first 100 lines)

**Standard project files** (any project):
- `package.json` — dependencies, scripts, project name
- `README.md` (first 100 lines) — project description, setup
- `tsconfig.json` — TypeScript config and paths

**Schema/ORM files** (read whichever exists):
- `prisma/schema.prisma` or any `*.prisma` file
- `src/models/` or `models/` directory (Mongoose, Sequelize, TypeORM entities)
- `drizzle/` or `src/db/schema.*` (Drizzle schemas)

**If key_facts.md is missing or minimal**, infer the stack from `package.json` dependencies and the directory structure detected in Phase 0.

The audit context should include (aim for 100-200 lines, not more):
1. **Project purpose** — what it does, who it's for (from README or key_facts)
2. **Architecture** — stack, key patterns, data flow, framework conventions
3. **Key decisions** — ADRs summarized in 1 line each (if decisions.md exists)
4. **Known issues** — from decisions.md, bugs.md, or TODO comments
5. **Specific audit focus areas** — based on the detected stack's risk profile:
   - Express/Fastify: middleware ordering, input validation, error handling
   - Next.js/Nuxt: SSR data fetching, API routes security, hydration issues
   - Vue/Svelte/Astro: component reactivity, XSS in templates, state management
   - Prisma: raw queries, migration safety, relation loading
   - Mongoose: schema validation gaps, injection in query operators
   - Auth: timing-safe comparison, token storage, session handling

Write this to disk:
```bash
REVIEW_DIR=$(cat /tmp/.review-project-dir)
cat > "$REVIEW_DIR/audit-context.md" <<'EOF'
[Your generated audit context here]
EOF
```

### Step 1b: Assemble Digest + Launch External Models

**Resume check**: if `$REVIEW_DIR/digest.txt` already exists, skip Step 1b entirely (digest was built in a previous run).

```bash
REVIEW_DIR=$(cat /tmp/.review-project-dir)

# 1. Review prompt header
cat > "$REVIEW_DIR/digest.txt" <<'HEADER'
You are performing a comprehensive review of a software project.
Your job is to find real problems — security, reliability, performance, architecture.
Do NOT manufacture issues. If code is solid, say so. Note uncertainty rather than flagging as issue.

For each issue: [CRITICAL/IMPORTANT/SUGGESTION] Category — Description
File: exact/path (line N if possible) — Proposed fix

Review criteria:
1. Security — injection, secrets, auth bypass, XSS, CSRF
2. Reliability — error handling, edge cases, race conditions, validation gaps
3. Performance — N+1 queries, missing indexes, memory leaks, unnecessary computation
4. Architecture — layer violations, tight coupling, SRP violations, dead code
5. Testing — coverage gaps, test quality, missing edge cases, flaky patterns
6. Documentation — spec/code mismatches, stale docs, missing API contracts

End with: VERDICT: HEALTHY | NEEDS_WORK (if any CRITICAL or 3+ IMPORTANT)
---
HEADER

# 2. Prepend audit context (project understanding for the external model)
echo "PROJECT CONTEXT:" >> "$REVIEW_DIR/digest.txt"
cat "$REVIEW_DIR/audit-context.md" >> "$REVIEW_DIR/digest.txt"
printf "\n---\nPROJECT FILES:\n" >> "$REVIEW_DIR/digest.txt"

# 3. Concatenate source files (all supported extensions, exclude tests/generated)
find . -type f -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "*/.next/*" \
  -not -path "*/.nuxt/*" -not -path "*/coverage/*" -not -path "*/build/*" -not -path "*/.svelte-kit/*" \
  \( -name "*.ts" -o -name "*.js" -o -name "*.tsx" -o -name "*.jsx" \
     -o -name "*.vue" -o -name "*.svelte" -o -name "*.astro" \
     -o -name "*.mjs" -o -name "*.cjs" \) \
  -not -name "*.test.*" -not -name "*.spec.*" -not -name "*.min.*" -not -name "*.d.ts" \
  | sort | while IFS= read -r f; do
    echo "=== FILE: $f ===" >> "$REVIEW_DIR/digest.txt"
    cat "$f" >> "$REVIEW_DIR/digest.txt"
    echo "" >> "$REVIEW_DIR/digest.txt"
  done

# 4. Add non-source config and documentation files (*.js/*.ts configs already captured by Step 3)
for doc in \
  package.json tsconfig.json angular.json \
  .env.example Dockerfile docker-compose.yml docker-compose.yaml \
  docs/project_notes/key_facts.md docs/project_notes/decisions.md \
  docs/specs/api-spec.yaml docs/specs/api-spec.json \
  .eslintrc .eslintrc.json \
; do
  if [ -f "$doc" ]; then
    echo "=== FILE: $doc ===" >> "$REVIEW_DIR/digest.txt"
    cat "$doc" >> "$REVIEW_DIR/digest.txt"
    echo "" >> "$REVIEW_DIR/digest.txt"
  fi
done

# 5. Add Prisma schema files (*.ts/*.js models already captured by Step 3)
find . -type f -name "*.prisma" -not -path "*/node_modules/*" | sort | while IFS= read -r f; do
  echo "=== FILE: $f ===" >> "$REVIEW_DIR/digest.txt"
  cat "$f" >> "$REVIEW_DIR/digest.txt"
  echo "" >> "$REVIEW_DIR/digest.txt"
done

# 6. Test file list (paths only)
echo "=== TEST FILES (paths only) ===" >> "$REVIEW_DIR/digest.txt"
find . -type f -not -path "*/node_modules/*" \( -name "*.test.*" -o -name "*.spec.*" \) \
  | sort >> "$REVIEW_DIR/digest.txt"

# 7. Check size
wc -c "$REVIEW_DIR/digest.txt"
```

Launch external models based on availability detected in Phase 0:

### Path A: Both CLIs available

```bash
REVIEW_DIR=$(cat /tmp/.review-project-dir)
export REVIEW_DIR
sh -c 'cat "$REVIEW_DIR/digest.txt" | gemini > "$REVIEW_DIR/review-gemini.txt" 2>&1; touch "$REVIEW_DIR/gemini.done"' &
DIGEST_SIZE=$(wc -c < "$REVIEW_DIR/digest.txt" | tr -d ' ')
if [ "$DIGEST_SIZE" -gt 600000 ]; then
  sh -c 'head -c 600000 "$REVIEW_DIR/digest.txt" | codex exec --full-auto - > "$REVIEW_DIR/review-codex.txt" 2>&1; touch "$REVIEW_DIR/codex.done"' &
else
  sh -c 'cat "$REVIEW_DIR/digest.txt" | codex exec --full-auto - > "$REVIEW_DIR/review-codex.txt" 2>&1; touch "$REVIEW_DIR/codex.done"' &
fi
echo "External models launched in background"
```

### Path B: One CLI available

```bash
REVIEW_DIR=$(cat /tmp/.review-project-dir)
export REVIEW_DIR
# Gemini only:
sh -c 'cat "$REVIEW_DIR/digest.txt" | gemini > "$REVIEW_DIR/review-gemini.txt" 2>&1; touch "$REVIEW_DIR/gemini.done"' &
# OR Codex only:
sh -c 'cat "$REVIEW_DIR/digest.txt" | codex exec --full-auto - > "$REVIEW_DIR/review-codex.txt" 2>&1; touch "$REVIEW_DIR/codex.done"' &
```

### Path C: No external CLI available — skip this phase. Claude-only review (Phase 2) still provides 6 domain reviews.

## Phase 2: Claude Deep Review (domain-by-domain, resumable)

While external models run, review the project by reading files directly. 6 domains, each written to disk immediately after completion.

**Check progress before each domain** — if `$REVIEW_DIR/progress.txt` shows `domain-N: DONE`, skip it (resume support).

**Important**: adapt each domain's focus to the actual stack detected in Phase 0. The descriptions below are guidelines — prioritize reading files that exist in this specific project.

### Domain 1: Architecture & Config
Read: package.json, tsconfig, framework config (next.config/nuxt.config/vite.config/angular.json), entry points, key_facts.md, decisions.md
Focus: structure, dependencies, config correctness, missing configs, framework best practices

### Domain 2: Source Code Quality
Read: routes/pages/components, services, models, utils, middleware (sample representative files)
Focus: naming, duplication, complexity, patterns, code smells, framework-specific anti-patterns

### Domain 3: Data Layer (skip for frontend-only)
Read: schema files (Prisma, Mongoose models, Sequelize/TypeORM entities, Drizzle), migrations, seeds, query builders
Focus: schema design, indexes, migrations, query efficiency, N+1 risks, ORM-specific pitfalls

### Domain 4: Testing & CI
Read: test files (sample), test config (jest/vitest/cypress/playwright), CI workflows, lint config
Focus: coverage gaps, test quality, CI robustness, flaky patterns

### Domain 5: Security & Reliability
Read: auth middleware, validators, error handlers, rate limiters, env handling
Focus: vulnerabilities, error paths, secrets exposure, OWASP top 10
- Backend: injection, auth bypass, SSRF, timing attacks, error leakage
- Frontend: XSS, CSP, token storage, route guards, dependency vulnerabilities, CORS

### Domain 6: Documentation & SDD Process
Read: tickets (sample), product-tracker, api-spec, bugs.md, README
Focus: spec/code sync, ticket quality, stale docs, process adherence

**After each domain**, write findings and a manifest of reviewed files to disk:

```bash
REVIEW_DIR=$(cat /tmp/.review-project-dir)
cat > "$REVIEW_DIR/review-domain-N.md" <<'EOF'
## Domain N: [Name]
### Files Reviewed
- path/to/file1.ts
- path/to/file2.vue
### Findings
[SEVERITY] Category — Description
File: path:line — Fix
...
EOF
echo "domain-N: DONE (X issues)" >> "$REVIEW_DIR/progress.txt"
```

## Phase 3: Consolidation

After all Claude domains complete, check external model outputs:

```bash
REVIEW_DIR=$(cat /tmp/.review-project-dir)
for model in gemini codex; do
  DONE="$REVIEW_DIR/$model.done"
  FILE="$REVIEW_DIR/review-$model.txt"
  if [ -f "$DONE" ] && [ -s "$FILE" ] && grep -qE "\[CRITICAL\]|\[IMPORTANT\]|\[SUGGESTION\]|VERDICT" "$FILE" 2>/dev/null; then
    echo "$model: done ($(wc -l < "$FILE") lines, valid)"
  elif [ -f "$DONE" ]; then
    echo "$model: finished but output appears malformed — review manually"
  else
    echo "$model: still running or not launched"
  fi
done
```

If pending, wait up to 2 minutes. If still pending, proceed with available results.

**Consolidation steps** (write to disk progressively per category):
1. Read Claude domain findings (up to 6 files from `$REVIEW_DIR/`)
2. Read external model outputs (up to 2 files from `$REVIEW_DIR/`)
3. For each finding, assign confidence:
   - **HIGH**: 2+ models flag the same file + same concern category
   - **MEDIUM**: 1 model, specific file/line cited
   - **LOW**: suggestion without specific evidence
4. Categorize: Security, Reliability, Performance, Architecture, Testing, Documentation
5. Prioritize: CRITICAL > IMPORTANT > SUGGESTION
6. Discard external model findings that lack severity markers or a VERDICT line

Write the consolidated report to `docs/project_notes/review-project-report.md`:

```markdown
# Project Review Report

**Date:** YYYY-MM-DD
**Models:** Claude, Gemini, Codex (or subset)
**Source files:** N | **Test files:** M | **Doc files:** K

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | N |
| IMPORTANT | N |
| SUGGESTION | N |

**Verdict:** HEALTHY | NEEDS_WORK

## CRITICAL

### C1. [Title]
- **Category:** Security
- **File:** path/to/file.ts:45
- **Found by:** Claude, Gemini (HIGH confidence)
- **Description:** ...
- **Fix:** ...

## IMPORTANT
...

## SUGGESTION
...
```

Write the action plan to `docs/project_notes/review-project-actions.md`:

```markdown
# Project Review — Action Plan

**Generated:** YYYY-MM-DD
**From:** review-project-report.md

## Quick Fixes (single file, localized change)
- [ ] C1: Description — `path/to/file.ts:45`

## Medium Effort (multi-file refactor, 1-3 hours)
- [ ] I1: Description

## Large Effort (schema/protocol/security redesign, > 3 hours)
- [ ] I2: Description

## Suggestions (optional)
- [ ] S1: Description
```

Ensure `docs/project_notes/` exists before writing: `mkdir -p docs/project_notes`.

## Notes

- This command is designed for **MVP milestones** — not for every commit
- External models get project context (audit-context.md) + concatenated source — this produces much better results than raw code alone
- Claude reads selectively (representative samples per domain), not exhaustively — external models compensate by getting ALL source in the digest
- For high-risk areas (auth, payments), consider a targeted review instead of this broad sweep
- Cross-cutting issues (spanning frontend+backend+DB) may need manual correlation across domain findings
- Each domain output includes a "Files Reviewed" manifest so you can verify coverage
- Works with any SDD project: new (`create-sdd-project`), existing (`--init`), any supported stack
