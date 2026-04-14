# Cross-Model Review — Calibration Notes

Reference for interpreting cross-model review output during spec/plan review (Steps 0 and 2 of the workflow).

## What cross-model review is for

Cross-model review runs the same spec or plan through TWO independent AI models (typically Codex CLI + Gemini CLI, or Codex + Claude). The goal is to surface issues that a single model would miss — not because the models are bad, but because different models have different failure modes.

Key insight: **two reviewers catching the same issue is strong signal. One reviewer catching an issue the other missed is also valuable — but you need to know *why* one missed it to calibrate correctly.**

## Reviewer patterns observed in practice

These patterns are not absolute — they're tendencies observed over many reviews. Use them to calibrate expectations, not to dismiss findings from any model.

### Codex CLI

- **Tends to be agentic** — runs shell commands (`rg`, `sed`, `find`, file reads) during review
- **Primary bug-finder** — catches mechanical mismatches (wrong file paths, stale type references, primary key type mismatches, dangling references in shared packages)
- **Cross-references plan claims against code** — high empirical rigor
- **Weakness**: can produce long, exhaustive output that buries the highest-severity findings in noise
- **Typical severity distribution for Standard/Complex plans**: 2-4 M1/M2 findings, 3-6 M3 suggestions

### Gemini CLI

- **Tends to be text-aware but less agentic** — reads the spec/plan and project standards, but may not grep the actual code
- **Primary standards-compliance checker** — catches inconsistencies between the plan and documented standards (base-standards.mdc, decisions.md)
- **Reads project context** via the `instructions` field of `.gemini/settings.json` — references `ai-specs/specs/`, `.gemini/agents/`, standards
- **Weakness**: can approve plans that look internally consistent but have mechanical bugs only visible through empirical verification
- **Typical severity distribution for Standard/Complex plans**: 1-2 M2 findings, 2-4 M3 suggestions

### Claude CLI (when used as third reviewer)

- **Tends to be analytical** — reasons through scope, ordering, edge cases
- **Primary scope-and-structure checker** — catches over-engineering, out-of-scope additions, feature creep
- **Weakness**: similar to Gemini, less empirical by default

## What the calibration means for you

### When reviews agree

If both reviewers flag the same finding, weight is high. Address first.

### When reviews disagree

Don't arbitrate from authority — arbitrate from evidence. If Codex cites `packages/api/prisma/schema.prisma:323` showing `id String @db.Uuid` and Gemini didn't read that file, Codex's finding carries the empirical weight. Resolve in Codex's direction.

If the disagreement is about scope or over-engineering (e.g., Codex says "add caching layer" and Gemini says "out of scope for this feature"), read both rationales carefully — this is where different models genuinely produce different takes. Lean toward YAGNI by default.

### When reviews are asymmetric (one light, one heavy)

Asymmetry is the most important signal. If Codex produces 3 M1 blockers and Gemini produces 0 M1 + 2 M3, **do NOT** conclude "Gemini approved so half of Codex's findings are wrong". Conclude: **"Gemini did a text-only review and missed the empirical bugs"**. The `review-plan` command includes an automated asymmetry check that re-prompts the light reviewer with stricter empirical instructions. Use it.

### When both reviews are light

If both produce 0 M1/M2 findings AND both produce empty "Files read during review" sections, the review is text-only. This is acceptable for trivial changes (one-line fixes, typo corrections) but NOT for Standard/Complex features. For non-trivial work, re-run the review with both reviewers and explicitly invoke the empirical verification checklist from the `review-plan` / `review-spec` commands.

## Historical calibration data

These are real examples from this project's history — add more as patterns emerge.

### F-UX-B Plan review (2026-04-13)

**Gemini** produced 48 lines, 2 M3 + 1 P2 findings, verdict APPROVE WITH CHANGES. Cited `ai-specs/specs/base-standards.mdc` section "5. Implementation Workflow" — demonstrably read project context.

**Codex** produced 829 lines, 3 M1 + 1 M2 + 2 M3, verdict REJECT. Ran `rg` and `sed` during review. Cited `packages/shared/src/schemas/standardPortion.ts:1-36`, `enums.ts:18-25`, `packages/api/prisma/schema.prisma:323`, `.gemini/agents/backend-planner.md:1-34`.

**Codex M1s were real bugs**: helper fallback produced "Media_racion" instead of "Media ración" (underscore bug); shared schema drift (PortionContextSchema existed in 2 places, one would become dangling); dishId validator expected positive int but DB column was uuid.

**Takeaway**: Gemini's context-loading fix (sdd-devflow v0.16.7) worked — it read standards correctly. But context loading ≠ empirical verification. Codex's agentic habit of running commands against the code caught bugs Gemini's text review missed. Both reviewers are needed and complementary.

## When to override the calibration

These are tendencies, not certainties. Override when:

- A "light" reviewer produces a specific, high-quality finding with cited evidence — don't dismiss it
- A "heavy" reviewer produces verbose output with few actionable findings — don't over-weight length
- A new model version changes behavior significantly — update this file with the new observation

The calibration is a tool, not a rule. Always read both reviews carefully.

## Related files

- `.claude/commands/review-spec.md` — spec review command with empirical checklist
- `.claude/commands/review-plan.md` — plan review command with empirical checklist + asymmetry meta-check
- `.claude/agents/backend-planner.md` — planner with Pre-Emission Verification section
- `.claude/agents/frontend-planner.md` — planner with Pre-Emission Verification section
