Review the Implementation Plan in the current ticket using external models for independent critique.

## Prerequisites

- An active feature with a completed Implementation Plan (Step 2)
- Ideally, one or more external AI CLIs installed: [Gemini CLI](https://github.com/google-gemini/gemini-cli), [Codex CLI](https://github.com/openai/codex), or similar

## What to do

1. **Find the current ticket** — Read `docs/project_notes/product-tracker.md` → Active Session → ticket path

2. **Detect available reviewers** — Check which external CLIs are installed:

```bash
command -v gemini >/dev/null 2>&1 && echo "gemini: available" || echo "gemini: not found"
command -v codex >/dev/null 2>&1 && echo "codex: available" || echo "codex: not found"
```

3. **Prepare the review input** — Extract the spec and plan into a temp file with the review prompt. Use the feature ID from the Active Session (e.g., `F023`):

```bash
TICKET="$(echo docs/tickets/F023-*.md)"  # Use the feature ID from Step 1; verify exactly one match
REVIEW_DIR="/tmp/review-plan-$(basename "$PWD")"
mkdir -p "$REVIEW_DIR"

cat > "$REVIEW_DIR/input.txt" <<'CRITERIA'
You are reviewing an Implementation Plan for a software feature. Your job is to find real problems, not praise. But if the plan is solid, say APPROVED — do not manufacture issues that are not there.

## CRITICAL: This is an EMPIRICAL review, not a text-only review

Before reporting findings, you MUST verify structural claims against the actual code. Plans often have subtle mechanical bugs (wrong paths, stale types, obsolete schemas, incorrect primary key types, dangling references in shared packages) that only surface when you verify empirically. A text-only review that reads the plan alone will miss them.

Required empirical checks before emitting findings:

1. **Read every file path the plan cites** — confirm it exists. If the plan says `packages/api/src/foo.ts`, open it. If it doesn't exist, that's a CRITICAL finding.
2. **Grep for every exported symbol** the plan claims to reuse, modify, or delete (types, enums, Zod schemas, functions, classes). Shared symbols often live in 2-3 places — one rewrite leaves dangling references if the others aren't cleaned in the same commit.
3. **Verify primary key and foreign key types** by reading the actual schema file (`prisma/schema.prisma` or equivalent). Don't assume `id` is a positive int when it's a `uuid`, and vice versa. Validator types MUST match the DB column type — this is one of the most common mechanical bugs in plans.
4. **For any DROP / DELETE / CASCADE operation**, grep the workspace for ALL references to the dropped symbol. The plan must clean them all in the same commit or the workspace breaks mid-migration.
5. **If the plan cites "Existing Code to Reuse"**, read those files to confirm they actually provide what the plan claims. Plans frequently cite helpers that don't exist or whose signature is different.

Do NOT rely on the plan's assertions alone. Do NOT assume file paths, types, or schemas are correct without verifying.

**Ticket-level signal to calibrate your review depth**: Look for a `### Verification commands run` subsection inside `## Implementation Plan`. If the planner listed empirical commands there, the plan was self-verified; focus your review on higher-order issues (gaps, vagueness, over-engineering). If that subsection is missing or empty, the plan is text-only and you MUST run the empirical checks above with extra rigor.

## Review criteria

Below you will find the Spec (what to build) and the Implementation Plan (how to build it). Review the plan and report:

1. Errors — Wrong assumptions, impossible steps, missing dependencies, plan contradicts the spec, **path/type/schema mismatches against the actual code (verified empirically)**
2. Gaps — Missing error handling, edge cases, rollback scenarios
3. Vagueness — Steps too ambiguous to implement with TDD (no clear input/output)
4. Over-engineering — Unnecessary abstractions, premature optimization
5. Order issues — Steps that depend on later steps

For each issue, state: `[CRITICAL/IMPORTANT/SUGGESTION] — description — proposed fix — cite the file:line you read to discover the issue when applicable`.

## Output format — mandatory sections

At the END of your review, include these two subsections:

### Files read during review
(list every file you opened, with brief note of what each confirmed or contradicted)

### Commands executed
(list every grep / find / sed / read command you ran, with the pattern)

If BOTH subsections are empty, prepend your review with: `⚠ TEXT-ONLY REVIEW — no empirical verification performed. Findings are based on plan text alone.`

End with: `VERDICT: APPROVED` | `VERDICT: REVISE` (if any CRITICAL or 2+ IMPORTANT issues)

---
SPEC AND PLAN:
CRITERIA

sed -n '/^## Spec$/,/^## Acceptance Criteria$/p' "$TICKET" >> "$REVIEW_DIR/input.txt"
```

4. **Send for review** — Execute **only one** of the following paths based on Step 2 results:

### Path A: Both CLIs available (best — two independent perspectives)

```bash
cat "$REVIEW_DIR/input.txt" | gemini > "$REVIEW_DIR/gemini.txt" 2>&1 &
PID_GEMINI=$!
cat "$REVIEW_DIR/input.txt" | codex exec - > "$REVIEW_DIR/codex.txt" 2>&1 &
PID_CODEX=$!

wait $PID_GEMINI && echo "Gemini: OK" || echo "Gemini: FAILED (exit $?) — check $REVIEW_DIR/gemini.txt"
wait $PID_CODEX && echo "Codex: OK" || echo "Codex: FAILED (exit $?) — check $REVIEW_DIR/codex.txt"

echo "=== GEMINI REVIEW ===" && cat "$REVIEW_DIR/gemini.txt"
echo "=== CODEX REVIEW ===" && cat "$REVIEW_DIR/codex.txt"
```

Consolidate findings — issues flagged by both models independently carry higher weight. Deduplicate and prioritize. Ignore output from any reviewer that failed.

### Meta-check: reviewer empirical asymmetry

After both reviews are in, check for empirical asymmetry. This guards against one model being text-only while the other does real empirical verification — a pattern observed in practice where different reviewers have different agentic habits.

**Primary check — qualitative, agent-driven**: Read both reviews yourself. If one review has a populated `### Files read during review` section with real file paths and line numbers, and the other review has an empty or missing section (or quotes the example text without adding real entries), the light review is incomplete. This is the authoritative check — the shell heuristic below is a secondary confirmation only.

**Secondary check — shell heuristic**: The following bash block is a mechanical double-check. It only flags **missing empirical evidence**, NOT low finding counts (a clean plan legitimately produces 0 CRITICAL/IMPORTANT findings; re-prompting on that is noise).

```bash
# Count REAL empirical markers — anchored to the mandatory markdown headers only,
# not to substring mentions elsewhere in the review text. Uses `wc -l` to avoid
# the `grep -c || echo 0` pitfall that produces "0\n0" when grep exits non-zero.
count_empirical() {
  local file="$1"
  [ -r "$file" ] || { echo 0; return; }
  # Look for non-empty lines under the two mandatory markdown headers.
  awk '
    /^### Files read during review$/ { in_files=1; in_cmds=0; next }
    /^### Commands executed$/ { in_files=0; in_cmds=1; next }
    /^### / { in_files=0; in_cmds=0 }
    (in_files || in_cmds) && NF > 0 && $0 !~ /^\(list/ { n++ }
    END { print n+0 }
  ' "$file"
}

GEMINI_EMPIRICAL=$(count_empirical "$REVIEW_DIR/gemini.txt")
CODEX_EMPIRICAL=$(count_empirical "$REVIEW_DIR/codex.txt")

echo "Empirical evidence — Gemini: $GEMINI_EMPIRICAL entries, Codex: $CODEX_EMPIRICAL entries"
```

**Trigger re-prompt ONLY when one reviewer has zero empirical entries**. Do NOT trigger based on finding counts — a clean plan legitimately produces zero findings, and re-prompting on that wastes time.

If re-prompt is needed, write a concrete reprompt file and re-run the light reviewer. Use CONCRETE shell variables, not literal `<angle>` placeholders (those are bash input redirects and will fail at runtime):

```bash
# Example — ONLY the SKELETON. Replace LIGHT_CLI, LIGHT_NAME, and OTHER_CLI with
# the actual reviewer details for your environment. This is documentation, not
# a cargo-cult-runnable block. Run the concrete version manually.

cat > "$REVIEW_DIR/reprompt.txt" <<'REPROMPT'
Your previous review was text-only: the `### Files read during review` section was empty or missing. Plans frequently have subtle mechanical bugs (wrong file paths, stale type references, primary key type mismatches, dangling shared-package references) that only appear with empirical verification.

Re-review the plan with EMPIRICAL verification. You MUST use your environment tools to read and grep real files. Do NOT hallucinate commands or output. You MUST:
1. Read every file path the plan cites and confirm it exists
2. Grep the workspace for every type/enum/schema/function the plan references
3. Verify primary and foreign key types against the actual schema file
4. For any DROP/DELETE/CASCADE, grep ALL references to confirm atomic cleanup
5. List the files you opened and the commands you ran at the END of your review, with real observed facts for each (not just the command string)

Look for: path mismatches, stale type references, primary key type mismatches, and dangling references in shared packages that need cleanup in the same commit.
REPROMPT

# Then re-run the LIGHT reviewer with the reprompt prepended. Example for Gemini:
#   cat "$REVIEW_DIR/reprompt.txt" "$REVIEW_DIR/input.txt" | gemini > "$REVIEW_DIR/gemini_reprompted.txt" 2>&1
#   cat "$REVIEW_DIR/gemini_reprompted.txt"
# Example for Codex:
#   cat "$REVIEW_DIR/reprompt.txt" "$REVIEW_DIR/input.txt" | codex exec - > "$REVIEW_DIR/codex_reprompted.txt" 2>&1
#   cat "$REVIEW_DIR/codex_reprompted.txt"
```

Merge the re-prompted findings into your consolidation. Do NOT skip this meta-check — it catches real bugs that would otherwise enter TDD.

See `.claude/skills/development-workflow/references/cross-model-review.md` for calibration notes on reviewer patterns (which models tend toward empirical verification vs standards-compliance checking).

### Path B: One CLI available

```bash
# Gemini only
cat "$REVIEW_DIR/input.txt" | gemini

# Codex only
cat "$REVIEW_DIR/input.txt" | codex exec -
```

### Path C: No external CLI available (self-review fallback)

If no external CLI is installed, perform the review yourself. Re-read the full Implementation Plan from the ticket, then review it with this mindset:

> Review the plan one more time trying to find any flaw, anything we might have forgotten, or any improvement that is missing. This is a very important part of the project and it is worth doing well. Do your best effort.

Apply the same 5 criteria from the prompt above. For each issue, state severity, description, and proposed fix. End with VERDICT.

5. **Process the review** — If any VERDICT is REVISE, update the plan addressing CRITICAL and IMPORTANT issues
6. **Optional second round** — Send the revised plan for a final audit if significant changes were made
7. **Log the review** — Add a note in the ticket's Completion Log: "Plan reviewed by [model(s) or self-review] — N issues found, N addressed"

## Notes

- This command is **optional** — the workflow's built-in Plan Self-Review (Step 2.4) always runs automatically
- Most valuable for **Complex** features or plans with 8+ steps
- External models run read-only — they review text, not code
- Both CLIs use their latest default model when no `-m` flag is specified — no need to hardcode model names
- Path C (self-review) is a last resort — external review gives genuinely independent perspectives that self-review cannot
