Run a cross-model review of the current plan or design using Gemini CLI and Codex CLI as independent reviewers.

Use this command when you have a plan ready for a non-trivial feature and want a second (and third) opinion before implementing. Works without a ticket file — the plan comes from the current conversation context or is provided inline.

## Prerequisites

- A plan or design described in the current conversation (or provided as $ARGUMENTS)
- One or more external AI CLIs installed: [Gemini CLI](https://github.com/google-gemini/gemini-cli), [Codex CLI](https://github.com/openai/codex)

## What to do

1. **Detect available reviewers**

```bash
command -v gemini >/dev/null 2>&1 && echo "gemini: available" || echo "gemini: not found"
command -v codex  >/dev/null 2>&1 && echo "codex: available"  || echo "codex: not found"
```

2. **Prepare the review input**

```bash
REVIEW_DIR="/tmp/cross-model-review-$(basename "$PWD")-$(date +%s)"
mkdir -p "$REVIEW_DIR"
```

Write a `$REVIEW_DIR/input.txt` file that contains:

- **Review prompt** (see template below)
- **The plan** — extracted from the conversation or written inline
- **Project context** — the source files most relevant to the plan (read them with the Read tool and append). Typically: the module the plan modifies, the modules it interfaces with, the config loader, `.env.example`, and `package.json`. Do NOT include every source file — choose the 4–6 files a reviewer needs to check consistency.

### Review prompt template

```
You are reviewing an IMPLEMENTATION PLAN for a software feature. Your job is to find real problems in the APPROACH. If the plan is solid, say APPROVED — do not manufacture issues.

## This is a CONTEXTUAL review — verify against the codebase

You MUST read the source files in the PROJECT CONTEXT section to check:
1. Does the plan introduce types/interfaces that already exist elsewhere?
2. Does the proposed API match the patterns used by similar modules?
3. Are env var names consistent with existing naming conventions?
4. Are there edge cases or failure modes the plan doesn't address?
5. Are optional dependency patterns consistent with how existing optional deps are handled?

## Review criteria

1. Correctness — Will the proposed implementation actually work? Any technical mistakes?
2. Completeness — Missing error handling, edge cases, cleanup?
3. Consistency — Does it follow the same patterns as the existing codebase?
4. Security — Any risk of leaking credentials or sensitive data?
5. Testing — Are the proposed tests sufficient? Can they run without real external services?
6. Dependencies — Are the chosen packages appropriate? Any lighter alternatives?
7. Scope — Is the plan doing too much or too little?

For each issue: `[CRITICAL/IMPORTANT/SUGGESTION] — description — proposed fix`

## Output format — mandatory sections

At the END of your review include:

### Files read during review
(list every file you examined, with brief note of what each confirmed or contradicted)

### Commands executed
(list any search commands you ran)

If BOTH sections are empty, prepend with: `⚠ TEXT-ONLY REVIEW — no empirical verification performed.`

End with: `VERDICT: APPROVED` | `VERDICT: REVISE` (if any CRITICAL or 2+ IMPORTANT issues)

---
## PLAN TO REVIEW

[INSERT PLAN HERE]

---
## PROJECT CONTEXT

[INSERT RELEVANT SOURCE FILES HERE]
```

3. **Send for review** — choose the path based on which CLIs are available:

### Path A: Both CLIs available (run in parallel)

```bash
cat "$REVIEW_DIR/input.txt" | gemini > "$REVIEW_DIR/gemini.txt" 2>&1 &
PID_GEMINI=$!
codex exec "$(cat "$REVIEW_DIR/input.txt")" > "$REVIEW_DIR/codex.txt" 2>&1 &
PID_CODEX=$!

wait $PID_GEMINI && echo "Gemini: OK" || echo "Gemini: FAILED — check $REVIEW_DIR/gemini.txt"
wait $PID_CODEX  && echo "Codex: OK"  || echo "Codex: FAILED — check $REVIEW_DIR/codex.txt"

echo "=== GEMINI ===" && cat "$REVIEW_DIR/gemini.txt"
echo "=== CODEX ===" && cat "$REVIEW_DIR/codex.txt"
```

Issues flagged by both models independently carry higher weight. Deduplicate and prioritize.

### Path B: One CLI available

```bash
# Gemini only
cat "$REVIEW_DIR/input.txt" | gemini

# Codex only
codex exec "$(cat "$REVIEW_DIR/input.txt")"
```

### Path C: No external CLI (self-review fallback)

Re-read the plan yourself as if you haven't seen it before. Apply the 7 criteria above. End with VERDICT. This is a last resort — external review gives genuinely independent perspectives.

4. **Check for empirical asymmetry**

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
echo "Empirical — Gemini: $(count_empirical "$REVIEW_DIR/gemini.txt"), Codex: $(count_empirical "$REVIEW_DIR/codex.txt")"
```

Re-prompt the light reviewer if one has zero empirical entries while the other has 3+:

```bash
cat > "$REVIEW_DIR/reprompt.txt" <<'REPROMPT'
Your previous review was text-only (### Files read during review was empty). Plans frequently have subtle mechanical bugs that only appear with empirical verification.

Re-review with CONTEXTUAL verification. You MUST read the source files in the PROJECT CONTEXT section and list them at the end under ### Files read during review.
REPROMPT

# Gemini:   cat "$REVIEW_DIR/reprompt.txt" "$REVIEW_DIR/input.txt" | gemini > "$REVIEW_DIR/gemini_r2.txt" 2>&1
# Codex:    codex exec "$(cat "$REVIEW_DIR/reprompt.txt" "$REVIEW_DIR/input.txt")" > "$REVIEW_DIR/codex_r2.txt" 2>&1
```

5. **Consolidate findings and update the plan**

For each CRITICAL or IMPORTANT issue:
- Apply the fix directly to the plan
- Note which model(s) flagged it

For SUGGESTIONS:
- Apply if they align with project conventions
- Skip if they conflict with intentional design decisions (document why)

6. **Optionally run a second round** if significant CRITICAL issues required structural changes.

## Notes

- Most valuable for features that introduce new modules, external dependencies, or touch security/credentials
- The `codex exec` subcommand is required for non-interactive use (plain `codex` requires a terminal)
- Both CLIs use their latest default model — no need to hardcode model names
- Keep the context files focused: 4–6 files is better than 15. Too much context degrades review quality
