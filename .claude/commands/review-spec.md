Review the Spec in the current ticket using external models for independent critique before planning.

## Prerequisites

- An active feature with a completed Spec (Step 0)
- Ideally, one or more external AI CLIs installed: [Gemini CLI](https://github.com/google-gemini/gemini-cli), [Codex CLI](https://github.com/openai/codex), or similar

## What to do

1. **Find the current ticket** — Read `docs/project_notes/product-tracker.md` → Active Session → ticket path

2. **Detect available reviewers** — Check which external CLIs are installed:

```bash
command -v gemini >/dev/null 2>&1 && echo "gemini: available" || echo "gemini: not found"
command -v codex >/dev/null 2>&1 && echo "codex: available" || echo "codex: not found"
```

3. **Prepare the review input** — Extract the spec, acceptance criteria, and project context into a temp file. Use the feature ID from the Active Session (e.g., `F023`):

```bash
TICKET="$(echo docs/tickets/F023-*.md)"  # Use the feature ID from Step 1; verify exactly one match
REVIEW_DIR="/tmp/review-spec-$(basename "$PWD")"
mkdir -p "$REVIEW_DIR"

cat > "$REVIEW_DIR/input.txt" <<'CRITERIA'
You are reviewing a Feature Specification for a software feature. Your job is to find real problems in the REQUIREMENTS — not the implementation (there is no implementation yet). If the spec is solid, say APPROVED — do not manufacture issues.

## This is a CONTEXTUAL review — verify consistency against the codebase

A spec review is not "how would I implement this" — that's for the plan phase. But a spec review IS responsible for detecting inconsistencies between what the spec claims and what already exists in the project. To do that rigorously, you MUST read project context files:

1. **Read the project standards** referenced in the spec (`ai-specs/specs/base-standards.mdc`, `backend-standards.mdc`, `frontend-standards.mdc`) — confirm the spec doesn't contradict them
2. **Read the key_facts.md and decisions.md** — confirm the spec doesn't reintroduce patterns the project explicitly rejected in a prior ADR
3. **Read the existing API spec** (`docs/specs/api-spec.yaml`) — confirm new endpoints don't collide with existing ones and follow the same conventions
4. **Grep for existing similar features** — if the spec proposes "add metrics for X", grep the workspace for existing metrics implementations to see if the spec is compatible with what's already there
5. **For any field, type, or enum the spec proposes**, grep shared schemas to see if a similar concept already exists under a different name

Do NOT review the spec as isolated text. A spec that looks internally consistent but contradicts the existing architecture is worse than one with obvious gaps.

## Review criteria

Below you will find the Spec (what to build), the Acceptance Criteria, and project context (architecture, decisions). Review the spec and report:

1. Completeness — Are all user needs covered? Missing requirements?
2. Ambiguity — Are requirements clear enough to plan and implement with TDD?
3. Edge cases — Are failure modes, boundary conditions, and error responses specified?
4. API contract — Are endpoints, fields, types, status codes well-defined? (if applicable)
5. Scope — Is the spec doing too much or too little for one feature?
6. Consistency — Does the spec conflict with existing architecture, patterns, or prior ADRs? **(verify by reading the referenced files, not by inference)**
7. Testability — Can each acceptance criterion be verified with an automated test?

For each issue, state: `[CRITICAL/IMPORTANT/SUGGESTION] — description — proposed fix — cite the file:line you read when the issue involves conflict with existing code`.

## Output format — mandatory sections

At the END of your review, include these two subsections:

### Files read during review
(list every file you opened, with brief note of what each confirmed or contradicted)

### Commands executed
(list every grep / find / sed / read command you ran, with the pattern)

If BOTH subsections are empty, prepend your review with: `⚠ TEXT-ONLY REVIEW — no empirical verification of architectural consistency. Findings are based on spec text alone.`

End with: `VERDICT: APPROVED` | `VERDICT: REVISE` (if any CRITICAL or 2+ IMPORTANT issues)

---
SPEC AND ACCEPTANCE CRITERIA:
CRITERIA

sed -n '/^## Spec$/,/^## Definition of Done$/p' "$TICKET" >> "$REVIEW_DIR/input.txt"

echo -e "\n---\nPROJECT CONTEXT (architecture and decisions):\n" >> "$REVIEW_DIR/input.txt"
cat docs/project_notes/key_facts.md >> "$REVIEW_DIR/input.txt" 2>/dev/null
echo -e "\n---\n" >> "$REVIEW_DIR/input.txt"
cat docs/project_notes/decisions.md >> "$REVIEW_DIR/input.txt" 2>/dev/null
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

After both reviews are in, check for empirical asymmetry. One reviewer may be text-only while the other reads files — re-prompt the light reviewer if so.

**Primary check — qualitative, agent-driven**: Read both reviews yourself. If one review cites actual files from the project (standards, decisions, existing schemas) and the other review contains only generic commentary, the light review is incomplete. This is the authoritative check.

**Secondary check — shell heuristic**: The block below only flags **missing empirical evidence**, NOT low finding counts. A clean spec legitimately produces zero findings; re-prompting on that wastes time.

```bash
count_empirical() {
  local file="$1"
  [ -r "$file" ] || { echo 0; return; }
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

**Trigger re-prompt ONLY when one reviewer has zero empirical entries**. If so, write a concrete reprompt file and re-run the light reviewer. Use CONCRETE shell variables, not literal `<angle>` placeholders:

```bash
# Documentation skeleton — replace with concrete reviewer invocation.

cat > "$REVIEW_DIR/reprompt.txt" <<'REPROMPT'
Your previous review was text-only: the `### Files read during review` section was empty or missing. Specs can silently contradict existing architecture (prior ADRs, established patterns, conflicting schemas) in ways that only surface when you read project context files.

Re-review the spec with CONTEXTUAL verification. You MUST use your environment tools to read real files. Do NOT hallucinate commands or output. You MUST:
1. Read ai-specs/specs/base-standards.mdc, backend-standards.mdc, frontend-standards.mdc
2. Read docs/project_notes/key_facts.md and decisions.md
3. Grep the workspace for existing similar features to check for collision or duplication
4. Verify proposed fields/types/enums don't already exist under different names in shared schemas
5. List the files you opened at the END of your review, with real observed facts for each

Look for: contradictions with prior ADRs, collisions with existing APIs, duplication of concepts that already exist under different names, spec vocabulary that doesn't match the project's existing terminology.
REPROMPT

# Example for Gemini:
#   cat "$REVIEW_DIR/reprompt.txt" "$REVIEW_DIR/input.txt" | gemini > "$REVIEW_DIR/gemini_reprompted.txt" 2>&1
# Example for Codex:
#   cat "$REVIEW_DIR/reprompt.txt" "$REVIEW_DIR/input.txt" | codex exec - > "$REVIEW_DIR/codex_reprompted.txt" 2>&1
```

Merge the re-prompted findings. See `.claude/skills/development-workflow/references/cross-model-review.md` for calibration notes on reviewer patterns.

### Path B: One CLI available

```bash
# Gemini only
cat "$REVIEW_DIR/input.txt" | gemini

# Codex only
cat "$REVIEW_DIR/input.txt" | codex exec -
```

### Path C: No external CLI available (self-review fallback)

If no external CLI is installed, perform the review yourself. Re-read the full Spec from the ticket, then review it with this mindset:

> You are an experienced engineer who has NOT seen this spec before. Question every assumption. Look for what is missing, ambiguous, or inconsistent with the project's architecture. Do not be lenient — find problems.

Apply the same 7 criteria from the prompt above. For each issue, state severity, description, and proposed fix. End with VERDICT.

5. **Process the review** — If any VERDICT is REVISE, update the spec addressing CRITICAL and IMPORTANT issues
6. **Optional second round** — Send the revised spec for a final audit if significant changes were made
7. **Log the review** — Add a note in the ticket's Completion Log: "Spec reviewed by [model(s) or self-review] — N issues found, N addressed"

## Notes

- This command is **optional** — the workflow's built-in Spec Self-Review (Step 0.4) always runs automatically
- Most valuable for **Standard/Complex** features where a wrong spec leads to wasted planning and implementation effort
- External models receive project context (key_facts + decisions) to check architectural consistency
- Both CLIs use their latest default model when no `-m` flag is specified — no need to hardcode model names
- Path C (self-review) is a last resort — external review gives genuinely independent perspectives that self-review cannot
