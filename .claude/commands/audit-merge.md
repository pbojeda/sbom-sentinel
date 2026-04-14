Run an automated compliance audit on the current feature before requesting merge approval.

## Prerequisites

- An active feature at Step 5 (Review) with Merge Checklist Evidence filled
- All quality gates passed (tests, lint, build)

## What to do

Read `docs/project_notes/product-tracker.md` → Active Session to identify the current feature, branch, and ticket path. Then run ALL checks below and report results in a table.

### Checks

**1. Ticket Status** — Read the ticket file. The `**Status:**` field in the header must be `Ready for Merge`. Flag if it shows any other value (In Progress, Spec, Planning, Review, Done).

**2. Acceptance Criteria** — Count `[x]` vs `[ ]` in the `## Acceptance Criteria` section. ALL must be `[x]`. Report ratio (e.g., "14/14").

**3. Definition of Done** — Count `[x]` vs `[ ]` in the `## Definition of Done` section. ALL must be `[x]`. Report ratio.

**4. Workflow Checklist** — Count `[x]` vs `[ ]` in the `## Workflow Checklist` section. All steps except Step 6 must be `[x]`. Step 6 should be `[ ]` (pending merge).

**5. Merge Checklist Evidence** — Verify the `## Merge Checklist Evidence` table has ALL rows marked `[x]` with real evidence (not placeholder text like "Sections verified: (list)").

**6. Completion Log** — Verify the `## Completion Log` table has at least one entry per executed workflow step. If bugs are mentioned in any entry, verify they are documented in `docs/project_notes/bugs.md`.

**7. Product Tracker Sync** — Read `docs/project_notes/product-tracker.md`:
  - Active Session must show step `5/6` with correct feature ID and branch
  - Features table must show the feature as `in-progress` at step `5/6`
  - Flag if stale or mismatched with ticket

**8. key_facts.md** — If the ticket's changes include new models, migrations, endpoints, modules, or shared utilities, verify they are documented in `docs/project_notes/key_facts.md`. If no new infrastructure, this is N/A.

**9. Merge Base** — Run these commands and report result:
```bash
TARGET_BRANCH="develop"  # or "main" — check key_facts.md branching-strategy
git fetch origin "$TARGET_BRANCH"
git merge-base --is-ancestor "origin/$TARGET_BRANCH" HEAD && echo "UP TO DATE" || echo "DIVERGED"
```
If DIVERGED, flag as FAIL with instruction to merge target branch first.

**10. Working Tree** — Run `git status`. Must show "nothing to commit, working tree clean".

**11. Data File Integrity** (if JSON/seed files are in the diff) — Check:
  - String arrays (aliases, tags): all values same casing convention
  - ID fields: no duplicates
  - Numeric fields: no negatives where unexpected
  - Object arrays: consistent shape (no missing keys)

Run only if `git diff origin/<target-branch>..HEAD --name-only` shows `.json` files in seed-data or fixtures directories.

### Output Format

Report as a compliance table:

```
## Merge Compliance Audit — [FEATURE-ID]

| # | Check | Status | Detail |
|---|-------|:------:|--------|
| 1 | Ticket Status | PASS | "Ready for Merge" |
| 2 | Acceptance Criteria | PASS | 14/14 |
| 3 | Definition of Done | PASS | 7/7 |
| 4 | Workflow Checklist | PASS | 7/8 (Step 6 pending) |
| 5 | Merge Checklist Evidence | PASS | 8/8 with evidence |
| 6 | Completion Log | PASS | 5 entries, bugs documented |
| 7 | Tracker Sync | PASS | Active Session + Features table correct |
| 8 | key_facts.md | PASS | N/A — no new infrastructure |
| 9 | Merge Base | PASS | Up to date with develop |
| 10 | Working Tree | PASS | Clean |
| 11 | Data Files | PASS | N/A — no JSON seed files |

**Verdict: READY FOR MERGE** (or **NEEDS FIX — N issues**)
```

### If issues are found

Fix them directly:
- Status wrong → update the ticket header
- AC/DoD unchecked → mark `[x]`
- Tracker stale → update Active Session and Features table
- Merge base diverged → `git merge origin/<target-branch>` and resolve conflicts
- Data file issues → fix the data

After fixing, re-run the audit to confirm all checks pass.

## Notes

- This command automates the compliance portion of the merge review — it does NOT replace code review, QA, or human architectural review
- Run this AFTER completing Action 8 (Fill Merge Checklist Evidence) and BEFORE Action 9 (Request merge approval)
- The output should be included in the merge approval request message so the reviewer can skip compliance checks and focus on code quality
