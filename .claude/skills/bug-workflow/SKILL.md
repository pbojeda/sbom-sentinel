---
name: bug-workflow
description: "Handles bug discovery, triage, investigation, and resolution. Invoke with: 'report bug', 'fix bug', 'hotfix needed', 'investigate bug', or 'triage bug'. For complex bugs, escalates to development-workflow."
---

# Bug Workflow Skill

## Commands

| Command | Situation |
|---------|-----------|
| `report bug` | Document a newly discovered bug |
| `triage bug` | Assess severity and priority |
| `investigate bug` | Find root cause |
| `fix bug` | Resolve a known bug |
| `hotfix needed` | Critical production bug |

---

## Severity & Paths

| Severity | Response | Path |
|----------|----------|------|
| Critical | Immediate (<1h) | **C: Hotfix** — Confirm → Branch from main → Minimal fix → Test → Deploy → Document → Post-mortem |
| High | Same day | **B: Standard** — Triage → Branch → Investigate → Fix (TDD) → Validate → Document → PR |
| Medium | Within cycle | **A: Quick** — Triage → Investigate → Fix → Test → Document → Commit |
| Low | Backlog | **A: Quick** or escalate to backlog |

**Escalate to `development-workflow`** when: >1 day work, architectural changes needed, or significant refactoring required.

---

## Step 1: Triage

Assess: **Severity** (impact?) → **Urgency** (how soon?) → **Scope** (how many affected?) → **Complexity** (how hard?)

Choose Path A/B/C based on severity, or Path D (escalate) if complex.

## Step 2: Branch (Paths B & C)

Check `key_facts.md` → `branching-strategy` for base branch:

| Path | Convention | Base (github-flow) | Base (gitflow) |
|------|------------|-------------------|----------------|
| Standard | `bugfix/<area>-<desc>` | `main` | `develop` |
| Hotfix | `hotfix/<desc>` | `main` | `main` (always) |

## Step 3: Investigate

Find root cause, not symptoms. Techniques: git bisect, layer isolation (Frontend → API → Service → DB), component isolation with mocks. **Time limits:** Critical 30min, High 2h, Medium 4h — then escalate.

## Step 4: Fix (TDD)

1. Write test that reproduces the bug (RED)
2. Confirm test fails (proves understanding)
3. Fix the code — minimal change (GREEN)
4. Confirm test passes + run all tests (no regression)

**Hotfix rules:** Minimal fix only. No refactoring. Add TODO for proper fix. Keep reversible.

## Step 5: Validate

Run `production-code-validator`. Ensure no debug code, proper error handling.

## Step 6: Document in bugs.md

```markdown
### YYYY-MM-DD - Brief Title

- **Severity:** High
- **Area:** Authentication
- **Issue:** [What happened]
- **Root Cause:** [Why it happened]
- **Solution:** [What was done]
- **Prevention:** [Test added or process change]
- **Commit:** abc123
```

## Step 7: Commit/PR

**Commit format:** `fix(<area>): <description>` + body (bug, root cause, fix) + `Co-Authored-By: Claude <noreply@anthropic.com>`

**Hotfix PR:** `--base main` always. After merge in GitFlow: merge main back to develop. Tag: `vX.Y.Z+1`.

---

## Hotfix Checklist (Critical only)

- [ ] Issue confirmed and understood
- [ ] Hotfix branch created from `main`
- [ ] Minimal fix implemented (reversible)
- [ ] Critical paths tested
- [ ] PR created with `--base main`
- [ ] Documented in bugs.md
- [ ] Proper fix ticket created (if hotfix was temporary)
- [ ] GitFlow: merged back to develop + tagged

## Memory Updates

| File | When |
|------|------|
| `product-tracker.md` | Bug being worked on (Active Session) |
| `bugs.md` | Always |
| `decisions.md` | If architectural decision made |

## Prevention (after every fix)

Ask: Why wasn't this caught? Can this happen elsewhere? What prevents recurrence?
