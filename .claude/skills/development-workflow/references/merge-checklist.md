# Merge Approval Checklist

> Execute ALL actions below IN ORDER before requesting merge approval from the user.
> Do NOT skip any action. Do NOT request merge approval until every action is complete.

## Action 0: Validate ticket structure

Re-read the ticket file (`docs/tickets/<feature-id>.md`).

Verify it contains ALL required sections: **Acceptance Criteria**, **Definition of Done**, **Workflow Checklist**, **Completion Log**, **Merge Checklist Evidence**.

**If ANY section is missing**, add it from `references/ticket-template.md` before continuing.

**Simple (lite ticket):** Verify same sections exist. Spec and Implementation Plan may be minimal (one-liner / N/A).

## Action 1: Mark all items and update Status

In the ticket file:

1. Update the **Status** field in the ticket header from `In Progress` to `Ready for Merge`
2. Mark ALL items `[x]` in:
   - **Workflow Checklist** — all steps that apply to this complexity tier (Simple: 1, 3, 4, 5. Standard: 0–5. Complex: 0–5)
   - **Acceptance Criteria** — every item
   - **Definition of Done** — every item
3. Add missing **Completion Log** entries: one row per step with date, action, and notes.

## Action 2: Verify product tracker

Re-read `docs/project_notes/product-tracker.md`.

- **Active Session** must show step `5/6 (Review)` with current context.
- **Features table** must show step `5/6` and status `in-progress`.

Fix if stale.

## Action 3: Update key_facts.md

If this feature added new models, schemas, migrations, endpoints, reusable components, error codes, or shared utilities → update `docs/project_notes/key_facts.md`.

## Action 4: Update decisions.md

If Definition of Done requires an ADR → add it to `docs/project_notes/decisions.md`.

## Action 5: Commit documentation

Commit ALL documentation updates from actions 0–4. Use commit message: `docs: update ticket, tracker, and project docs for <feature-id>`.

## Action 6: Verify clean working tree

Run `git status`. **No unstaged or untracked files allowed.** If any remain, stage and commit them.

## Action 7: Verify branch is up to date with target

Determine the target branch from `docs/project_notes/key_facts.md` → `branching-strategy` (github-flow → `main`, gitflow → `develop`).

1. Fetch latest: `git fetch origin <target-branch>`
2. Check divergence: `git merge-base --is-ancestor origin/<target-branch> HEAD`
   - If the command **succeeds** (exit code 0) → the feature branch already contains all target branch commits. Proceed to Action 8.
   - If the command **fails** (exit code 1) → the feature branch has diverged.
3. **If diverged:** Merge the target branch into the feature branch:
   - `git merge origin/<target-branch>`
   - If **conflicts** occur: resolve them, run quality gates (`npm test`, lint, build) again, and commit the merge.
   - If no conflicts: the merge commit is created automatically.
4. After merging, verify clean working tree again (`git status`).

## Action 8: Fill Merge Checklist Evidence

In the ticket, fill the `## Merge Checklist Evidence` table. For each action (0–7), mark `[x]` and write the actual evidence (not placeholders). Example:

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Plan, AC, DoD, Workflow, Log, Evidence |
| 1. Mark all items | [x] | AC: 12/12, DoD: 7/7, Workflow: 0-5/6 |

## Action 9: Run compliance audit

Run `/audit-merge` to verify all compliance checks pass automatically. If any check fails, fix it and re-run until all pass.

Include the audit output in the merge approval request message so the reviewer can skip compliance checks and focus on code/architecture review.

## Action 10: Request merge approval

Verify the compliance audit passed and the Merge Checklist Evidence table is fully filled.

THEN — and only then — request merge approval from the user.
