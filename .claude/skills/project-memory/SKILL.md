---
name: project-memory
description: "Set up and maintain a structured project memory system in docs/project_notes/ that tracks bugs with solutions, architectural decisions, key project facts, and work history. Use this skill when asked to 'set up project memory', 'track our decisions', 'log a bug fix', 'update project memory', or 'initialize memory system'."
---

# Project Memory

## Overview

Maintain institutional knowledge for projects by establishing a structured memory system in `docs/project_notes/`. This skill sets up three key memory files (bugs, decisions, key facts) plus the product tracker, and configures the main AI instruction file to automatically reference and maintain them.

## When to Use This Skill

Invoke this skill when:

- Starting a new project that will accumulate knowledge over time
- The project already has recurring bugs or decisions that should be documented
- The user asks to "set up project memory" or "track our decisions"
- The user wants to log a bug fix, architectural decision, or completed work
- Encountering a problem that feels familiar ("didn't we solve this before?")
- Before proposing an architectural change (check existing decisions first)

## Core Capabilities

### 1. Initial Setup - Create Memory Infrastructure

When invoked for the first time in a project, create the following structure:

```
docs/
└── project_notes/
    ├── bugs.md              # Bug log with solutions
    ├── decisions.md         # Architectural Decision Records
    ├── key_facts.md         # Project configuration and constants
    └── product-tracker.md   # Feature backlog, active session, completion log
```

**Initial file content:** Copy templates from the `references/` directory in this skill:
- Use `references/bugs_template.md` for initial `bugs.md`
- Use `references/decisions_template.md` for initial `decisions.md`
- Use `references/key_facts_template.md` for initial `key_facts.md`
- Product tracker is created using the development-workflow skill

### 2. Configure AI Instruction File - Memory-Aware Behavior

Add or update a "Project Memory System" section in the project's main AI instruction file (e.g., `CLAUDE.md`):

```markdown
## Project Memory System

This project maintains institutional knowledge in `docs/project_notes/`.

### Memory Files
- **product-tracker.md** - Feature backlog, active session, completion log
- **bugs.md** - Bug log with dates, solutions, and prevention notes
- **decisions.md** - Architectural Decision Records (ADRs)
- **key_facts.md** - Project configuration, ports, important URLs

### Memory-Aware Protocols

**Before proposing architectural changes:**
- Check `docs/project_notes/decisions.md` for existing decisions

**When encountering errors or bugs:**
- Search `docs/project_notes/bugs.md` for similar issues

**When looking up project configuration:**
- Check `docs/project_notes/key_facts.md`

**When completing work:**
- Update product tracker and add to Completion Log
```

### 3. Searching Memory Files

When encountering problems or making decisions, proactively search memory files:

- Search `bugs.md` for similar errors
- Search `decisions.md` for related decisions
- Search `key_facts.md` for configuration details

### 4. Updating Memory Files

**Adding a bug entry:**
```markdown
### YYYY-MM-DD - Brief Bug Description
- **Issue**: What went wrong
- **Root Cause**: Why it happened
- **Solution**: How it was fixed
- **Prevention**: How to avoid it in the future
```

**Adding a decision:**
```markdown
### ADR-XXX: Decision Title (YYYY-MM-DD)

**Context:**
- Why the decision was needed

**Decision:**
- What was chosen

**Alternatives Considered:**
- Option 1 → Why rejected

**Consequences:**
- Benefits and trade-offs
```

**Adding key facts:**
- Organize by category
- Use bullet lists for clarity
- Include both production and development details

### 5. Memory File Maintenance

- User is responsible for manual cleanup
- Remove very old bug entries (6+ months) that are no longer relevant
- Review and clean up completed features in product tracker
- Keep all decisions (they provide historical context)
- Update key_facts.md when project configuration changes

## Templates and References

- **references/bugs_template.md** - Bug entry format with examples
- **references/decisions_template.md** - ADR format with examples
- **references/key_facts_template.md** - Key facts organization with examples

Product tracker is created using the development-workflow skill.

## Tips for Effective Memory Management

1. **Be proactive**: Check memory files before proposing solutions
2. **Be concise**: Keep entries brief (1-3 lines for descriptions)
3. **Be dated**: Always include dates for temporal context
4. **Be linked**: Include URLs to tickets, docs, dashboards
5. **Be selective**: Focus on recurring or instructive issues, not every bug

## Integration with Other Skills

- **development-workflow**: Updates product tracker and memory files during task execution
- **bug-workflow**: Documents bugs and solutions in bugs.md

## Success Criteria

This skill is successfully deployed when:

- `docs/project_notes/` directory exists with memory files
- Product tracker exists with feature backlog
- AI instruction file includes "Project Memory System" section
- Memory files follow template format
- AI assistant checks memory files before proposing changes
