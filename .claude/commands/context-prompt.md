Generate a complete context recovery prompt to paste after /compact or at the start of a new session.

## What to include

The prompt must contain EVERYTHING needed for a new session (or post-compact) to continue work without information loss:

1. **Project state**: current branch, last commit, working tree status, SDD version
2. **Workflow**: SDD development workflow, autonomy level, branching strategy
3. **Active feature**: current step in the 6-step workflow, what has been done, what remains
4. **Epics and progress**: table with status of each epic
5. **Backlog**: pending features with priorities and dependencies
6. **Infrastructure**: key modules, endpoints, schemas, with exact file paths
7. **Tests**: total count, files, lint/build/tsc status
8. **Key files to read**: list of files the new session must read first
9. **Next action**: the specific next thing to do, with context
10. **User notes**: any decisions or constraints communicated by the user

### Workflow Recovery (CRITICAL)

This section prevents the agent from losing track of the development process after /compact:

11. **Current workflow step**: Which of the 6 steps (Spec, Setup, Plan, Implement, Finalize, Review) is active
12. **Pending checkpoints**: Which approvals remain (Spec, Ticket, Plan, Commit, Merge)
13. **Merge checklist reminder**: If at Step 5 or later, explicitly state: "Before requesting merge approval, you MUST read `references/merge-checklist.md` and execute ALL actions (0-8). Fill the `## Merge Checklist Evidence` table in the ticket with real evidence for each action."
14. **Step order reminder**: "After commit+PR, run code-review-specialist and qa-engineer (Step 5), then execute merge-checklist actions. Do NOT request merge approval without completing the checklist."

## How to generate

- Read `docs/project_notes/product-tracker.md` (Active Session + Features tables + Completion Log)
- Read `docs/project_notes/decisions.md` (recent ADRs)
- Read `docs/project_notes/key_facts.md` (stack, components)
- Read the current ticket in `docs/tickets/` if a feature is active
- Run `git log --oneline -5` and `git status` for current state
- Read `.sdd-version` for SDD DevFlow version

## Output format

Structured markdown with tables, ready to paste directly as the first message of a new session. The prompt should be self-contained — the receiving agent should not need to ask clarifying questions.

## Context

- Users work remotely with long sessions — interruptions are costly
- After /review-plan + plan approval, context is typically at 50%+ usage, making /compact necessary before implementation
- The workflow recovery section is essential: without it, the agent may skip merge checklist actions after /compact
