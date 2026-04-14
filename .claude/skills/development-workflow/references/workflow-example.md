# Workflow Example: Feature F001 (Simple, L2 Trusted, github-flow)

## On Skill Start

1. Read product tracker → Active Session → No active feature
2. `CLAUDE.md` → Autonomy Level 2 (Trusted)
3. `key_facts.md` → branching: github-flow (base: `main`)

## Step 0: Spec — Skipped (Simple task)

## Step 1: Setup

```bash
git checkout main && git pull
git checkout -b feature/F001-express-setup
```

Update product tracker → Active Session: F001, step `1/6`, branch, complexity: Simple.

## Step 2: Plan — Skipped (Simple task)

## Step 3: Implement (TDD)

Update tracker: step `3/6 (Implement)`. Update `api-spec.yaml` in real time (e.g., health endpoint).

**Cycle 1 — Express App:**

```typescript
// RED: backend/src/app.test.ts
import app from './app';
describe('Express App', () => {
  it('should create an Express application', () => {
    expect(app).toBeDefined();
  });
});
// npm test → FAIL

// GREEN: backend/src/app.ts
import express from 'express';
const app = express();
export default app;
// npm test → PASS
```

**Cycle 2 — Health Endpoint:**

```typescript
// RED
describe('GET /health', () => {
  it('should return 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

// GREEN
app.get('/health', (req, res) => res.json({ status: 'ok' }));
```

## Step 4: Finalize

Update tracker: step `4/6`. Run validator → fix `console.log` → re-validate → PASS.

L2 auto-approves commit for Simple tasks. Log in tracker.

```bash
git commit -m "feat(backend): initialize Express + TypeScript project
..."
```

## Step 5: Review

```bash
git push -u origin feature/F001-express-setup
gh pr create --base main --title "feat(backend): initialize Express + TypeScript project" --body "..."
gh pr merge --squash
```

## Step 6: Complete

```bash
git checkout main && git pull
git branch -d feature/F001-express-setup
```

Update product tracker: F001 → done, add to Completion Log, clear Active Session.
