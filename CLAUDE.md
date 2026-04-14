<!-- See AGENTS.md for universal project instructions (structure, commands, memory, anti-patterns). -->
<!-- See ai-specs/specs/base-standards.mdc for methodology (constitution, workflow, agents, git). -->

## Claude-Specific Configuration

<!-- CONFIG: Set your preferred autonomy level (1-5). See base-standards.mdc § Autonomy Levels for definitions. -->
**Autonomy Level: 2 (Trusted)**

<!-- CONFIG: Set branching strategy in docs/project_notes/key_facts.md (github-flow or gitflow) -->

## Session Recovery (Claude Code)

After context compaction or new session — BEFORE continuing work:

1. Read product tracker (`docs/project_notes/product-tracker.md`) → **Active Session**
2. If active feature → read referenced ticket in `docs/tickets/`
3. Re-read the workflow skill (`.claude/skills/development-workflow/SKILL.md`) to know what actions the current step requires
4. If at Step 5 or later → read `references/merge-checklist.md` and check if the ticket's `## Merge Checklist Evidence` table needs to be filled
5. Do NOT proceed past any checkpoint without user confirmation (respect autonomy level)
6. If Active Session shows a pending checkpoint, ask before continuing
7. If L5 (PM Autonomous) and `docs/project_notes/pm-session.md` exists → read it and run `continue pm` to resume the PM Orchestrator session
