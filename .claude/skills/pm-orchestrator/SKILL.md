---
name: pm-orchestrator
description: "PM Agent that orchestrates sequential multi-feature development. Invoke with: 'start pm', 'continue pm', 'stop pm', or 'pm status'."
---

# PM Orchestrator

Autonomously develops multiple features in sequence using the `development-workflow` skill. Requires **L5 (PM Autonomous)** autonomy level.

## Commands

| Command | Action |
|---------|--------|
| `start pm` | Start a new autonomous session — classify batch, then loop |
| `continue pm` | Resume after /compact or session restart |
| `stop pm` | Graceful stop after current feature completes |
| `pm status` | Show progress summary from pm-session.md |

## Prerequisites

Before starting:

1. **Autonomy Level must be L5.** Read `CLAUDE.md` → verify `Autonomy Level: 5 (PM Autonomous)`. If not L5, tell the user and stop.
2. **Product tracker must have pending features.** Read `docs/project_notes/product-tracker.md` → Features table. If no features have step < 6/6, there is nothing to do.
3. **Working tree must be clean.** Run `git status`. If dirty, ask user to commit or stash.
4. **No active PM session.** Check if `docs/project_notes/pm-session.lock` exists. If it does, another PM session may be running — ask user before proceeding.
5. **Target branch quality gates baseline.** Run `npm test`, `npm run lint`, and `npm run build` on the target branch (main or develop) to verify it is clean BEFORE starting any feature. If any gate fails:
   - Document the failures in `docs/project_notes/bugs.md` as a tech debt entry (e.g., `BUG-DEV-LINT-XXX`).
   - Create a follow-up task in `product-tracker.md` to fix the baseline.
   - STOP and inform the user. Do NOT start features on a broken baseline — features will fail Step 4 quality gates and the agent will be unable to distinguish pre-existing failures from regressions.
   - Exception: if the lint command itself does not exist for some packages, note it but do not block.

---

## `start pm` — New Autonomous Session

### Phase 0: Previous Session Cleanup

1. Check if `docs/project_notes/pm-session.md` exists.
2. If it exists and Status is `completed` or `stopped`:
   - Archive it: rename to `docs/project_notes/pm-session-{session-id}.md` (e.g., `pm-session-pm-c3a.md`).
   - Print: `[PM] Archived previous session {session-id} → pm-session-{session-id}.md`
3. If it exists and Status is `in-progress`: warn the user that a session is still active — suggest `continue pm` or `stop pm` first.

### Phase 1: Batch Selection

1. Read `docs/project_notes/product-tracker.md` → collect all features with step < 6/6.
2. **Filter out** features whose dependencies are not yet done (check the Dependencies column and verify the dependency feature has step 6/6).
3. **Sort** by priority (High > Medium > Low), then by feature ID ascending.
4. Present the first **1-3 eligible features** to the user as a rolling batch:

```
PM Orchestrator — Batch Classification

These features are ready to develop:

| # | Feature | Type | Priority | Dependencies |
|---|---------|------|----------|--------------|
| 1 | F014 — Short Name | backend | High | F006 (done) |
| 2 | F015 — Short Name | backend | Medium | none |
| 3 | F016 — Short Name | fullstack | Medium | F014 |

Classify complexity for each (Simple / Standard / Complex):
```

5. Wait for user to classify all features in the batch.
6. **Intra-batch dependency check.** Before proceeding, verify that no feature in the batch depends on another feature in the same batch. If F-Y depends on F-X and both are in the batch:
   - Warn the user explicitly: "F-Y depends on F-X which is also in this batch. F-X's results will be auto-merged at L5 without your validation before F-Y starts. If F-Y's spec/implementation depends on decisions made in F-X, those decisions won't have been validated by you."
   - Ask the user: "Do you want to (a) remove F-Y from this batch and run it in a future session after validating F-X, or (b) proceed knowing the risk?"
   - Default to (a) — only proceed with (b) if the user explicitly confirms.

### Phase 2: Session Initialization

1. Create `docs/project_notes/pm-session.lock` with content: `session started at {ISO date}`.
2. Create `docs/project_notes/pm-session.md` from `references/pm-session-template.md`:
   - Fill **Started** date, **Session ID** (short random ID), **Target Branch** (from `docs/project_notes/key_facts.md` → branching strategy: github-flow → `main`, gitflow → `develop`).
   - Fill the **Current Batch** table with classified features.
   - Set **Status** to `in-progress`.

### Phase 3: Orchestration Loop

For each feature in the batch:

#### a. Pre-flight Checks

- **Kill switch**: If `docs/project_notes/pm-stop.md` exists → stop gracefully (go to Shutdown).
- **Lock**: If `docs/project_notes/pm-session.lock` is missing → stop (session was terminated externally).
- **Circuit breaker**: If 3 consecutive features are `blocked` → stop and report to user.
- **Context check**: If **2+ features have been completed** in this session, STOP and tell the user to run `/compact` followed by `continue pm`. Do NOT continue to the next feature — context degradation causes skipped steps, lost constraints, and poor quality. This is mandatory, not a suggestion.
- **Clean workspace**: Run `git status`. If dirty, commit or stash before proceeding.

#### b. Start Feature

1. Update `pm-session.md`:
   - Set current feature status to `in-progress`, note step 0/6.
   - Update **Recovery Instructions**: set **Current feature**, **Branch** (once created), and current step.
2. **Print progress**: `[PM] Starting FXXX — Step 0: Spec`
3. Invoke the `development-workflow` skill:
   - Command: `start task FXXX as [Simple|Standard|Complex]`
   - The development-workflow reads L5 → all checkpoints auto-approve.
   - All quality gates run as normal (tests, lint, build, validators, code review, QA).
   - At Step 5 (Review): execute `/audit-merge` before the merge checklist evidence.
4. **During the feature lifecycle**, keep `pm-session.md` up to date:
   - Update the **Notes** column with current step (e.g., "Step 3/6 — Implementation").
   - Update **Recovery Instructions** with the current step and branch after each step transition.
   - Print a one-liner when entering each step: `[PM] FXXX | Step N/6 | StepName`
   - Print when a quality gate passes/fails: `[PM] FXXX | Step 4 | tests: PASS (133/133)`

#### c. Feature Completed (Step 6 done)

1. Verify `docs/project_notes/product-tracker.md` shows the feature at step 6/6 with status `done`.
2. **Post-merge sanity check**: Run `npm test` (or the project's test command) on the target branch.
   - If tests **fail** → STOP immediately. The merged feature broke the target branch. Report to user.
   - If tests **pass** → print: `[PM] FXXX | Post-merge sanity: PASS`
3. Update `pm-session.md`:
   - Move the feature row from **Current Batch** to **Completed Features**.
   - Record approximate duration in the Duration column.
   - Clear **Recovery Instructions** current feature (or set to next feature).
4. Print: `[PM] FXXX | DONE (~Xmin) | Moving to next feature`
5. Reset consecutive failure counter to 0.

#### d. Feature Failed

If the development-workflow encounters a failure during any step:

1. The existing retry/fix loop runs (max 3 retries per step, per the `failure-handling.md` reference).
2. If retries exhausted:
   - Update `pm-session.md`: set feature status to `blocked`, note the failure reason.
   - Increment consecutive failure counter.
   - Skip to the next feature in the batch.
3. If merge conflicts prevent completion:
   - Mark as `blocked` with reason "merge conflict".
   - Skip to next feature.

#### e. Batch Boundary

After each completed or blocked feature:

1. **Re-read** `docs/project_notes/product-tracker.md` to check for newly unblocked features (dynamic dependency resolution).
2. If the current batch is exhausted and more eligible features remain:
   - Present the next 1-3 features to the user for complexity classification.
   - Add them to the batch in `pm-session.md`.
3. If **2+ features completed** in this session → STOP and tell the user to run `/compact` followed by `continue pm`. This is mandatory — do not ask, do not continue.
4. If max session limit reached (**5 features**) → stop and report.

### Phase 4: Shutdown

1. Update `pm-session.md`:
   - Set **Status** to `completed` (if all done) or `stopped` (if interrupted).
   - Ensure all feature statuses are up to date.
2. Remove `docs/project_notes/pm-session.lock`.
3. Remove `docs/project_notes/pm-stop.md` if it exists.
4. Print final report:

```
PM Session Complete

| Feature | Status | Duration | Notes |
|---------|--------|----------|-------|
| F014 | done | ~8 min | Clean |
| F015 | done | ~12 min | 1 QA fix |
| F016 | blocked | — | Merge conflict |

Completed: 2/3 | Blocked: 1/3 | Remaining: 0
```

---

## `continue pm` — Resume After /compact or Restart

1. Read `docs/project_notes/pm-session.md`. If it doesn't exist, inform user there is no active session.
2. **Validate session Status.** If Status is `completed` or `stopped`, inform user the session has ended. To start a new one, run `start pm` (it will archive the old session automatically).
3. **Re-create lock.** If `docs/project_notes/pm-session.lock` is missing (e.g., after terminal crash), re-create it with content: `session resumed at {ISO date}`.
4. Find the feature with status `in-progress`:
   - Read its ticket file and the product tracker Active Session to determine current step.
   - Resume the `development-workflow` from that step.
5. After the in-progress feature completes, re-enter the Orchestration Loop at step (e).
6. If no `in-progress` feature exists but `pending` features remain, pick the next one and enter step (b).

---

## `stop pm` — Graceful Stop

1. Create `docs/project_notes/pm-stop.md` with content: `stop requested at {ISO date}`.
2. The orchestration loop will detect this file at the next pre-flight check and shut down gracefully.
3. The current feature will complete its current step before stopping.

---

## `pm status` — Progress Summary

1. Read `docs/project_notes/pm-session.md`.
2. Display the Current Batch table and Recovery Instructions.
3. If no session exists, inform the user.

---

## Guardrails

| Guardrail | Value | Rationale |
|-----------|-------|-----------|
| Max features per session | 5 | Model attention degrades after many iterations |
| Mandatory compact after 2 features | STOP + `/compact` + `continue pm` | Context degradation causes skipped steps and lost constraints |
| Target branch baseline check | tests/lint/build before first feature | Pre-existing failures would block Step 4 quality gates and contaminate audit trails |
| Intra-batch dependency check | Warn + default to remove dependent feature | Auto-merge at L5 means dependent feature won't see user-validated parent results |
| Consecutive failure circuit breaker | 3 | Prevent wasting resources on a systemic issue |
| Kill switch | `pm-stop.md` or `stop pm` | User can always halt the loop |
| Session lock | `pm-session.lock` | Prevents concurrent PM sessions |
| Quality gates | Always enforced | Tests, lint, build, validators, code review, QA, `/audit-merge` |
| Post-merge sanity | `npm test` on target branch | Catch regressions immediately |
| Rolling batch | 1-3 features | Avoid over-committing; allows dynamic re-prioritization |
| Clean workspace | `git status` before each feature | Prevent dirty state contamination |

## Edge Cases

1. **Feature mid-execution during /compact**: `continue pm` reads pm-session.md → finds in-progress feature → reads tracker Active Session → resumes development-workflow from that step.

2. **pm-session.md vs tracker disagreement**: Product tracker is the **source of truth**. If pm-session.md says "done" but tracker says "in-progress", trust the tracker and re-verify.

3. **User modifies tracker mid-session**: PM re-reads tracker between features (not mid-feature). Changes take effect at the next feature boundary.

4. **Branch already exists**: development-workflow Step 1 handles this — checks out existing branch and resumes.

5. **L5 selected but `start task` used directly**: development-workflow at L5 behaves exactly like L4 (all checkpoints auto). The PM loop is opt-in via `start pm`, not forced by L5.

6. **Batch classification changes**: User can `stop pm`, edit pm-session.md complexity column, then `continue pm`.

7. **Post-merge sanity check fails**: STOP immediately. The merged feature introduced a regression on the target branch. Do NOT continue — user must investigate manually.

8. **Gemini CLI limitations**: PM Orchestrator instructions are mirrored for Gemini. L5 PM Orchestrator is fully designed for Claude Code; Gemini support is best-effort.

## References

- `references/pm-session-template.md` — Template for the session state file
- `.claude/skills/development-workflow/SKILL.md` — The workflow invoked for each feature
- `docs/project_notes/product-tracker.md` — Source of truth for feature status
- `.claude/skills/development-workflow/references/failure-handling.md` — Retry and rollback patterns

## Constraints

- **One feature at a time.** Sequential execution only — no parallel features.
- **Do NOT skip quality gates.** Even at L5, tests/lint/build/validators/review/QA always execute.
- **Do NOT force-resolve merge conflicts.** Mark as blocked and skip.
- **Do NOT modify pm-session.md format.** Follow the template structure exactly.
- **Do NOT continue after post-merge sanity failure.** Stop and report.
- **Do NOT make architectural decisions without checking first.** Before choosing a new approach, library, or pattern:
  1. Search the existing codebase for similar solutions (other packages, shared modules, existing endpoints).
  2. Check `docs/project_notes/decisions.md` and `docs/project_notes/key_facts.md` for prior decisions.
  3. If the project uses multiple packages/modules, check how they solved the same problem.
  4. If still uncertain, ask the user or consult external AI models (Gemini CLI, Codex CLI) before proceeding.
  5. If the chosen approach creates a dependency on something that doesn't exist yet (e.g., a backend endpoint), create a follow-up task in `product-tracker.md` to track it.
