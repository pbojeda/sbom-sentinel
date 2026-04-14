# Task Complexity Guide

## How to Ask About Complexity

Before starting any task, ask the user to classify its complexity using **context-aware options**:

```
"What complexity level for [TASK-ID] ([Task Name])?"

1. Simple (Recommended if applicable)
   [Specific description of what "simple" means for THIS task]

2. Standard
   [Specific description of what "standard" means for THIS task]

3. Complex / Skip / Alternative
   [Context-aware third option]
```

## Examples

**Example 1 - Feature might overlap with existing work:**
```
What complexity level for F003 (Implement refresh token rotation)?

1. Simple (Recommended)
   Verify existing implementation in F001, add tests if missing

2. Standard
   Add additional rotation logic or edge cases

3. Skip F003
   Already done in F001, move to F004 (auth controller)
```

**Example 2 - Standard new feature:**
```
What complexity level for F002 (Create auth middleware)?

1. Simple
   Straightforward middleware, minimal logic

2. Standard (Recommended)
   JWT verification, role checking, error handling

3. Complex
   Multiple middleware types, extensive edge cases
```

## Discussion Option

The user always has the option to **discuss the task** instead of selecting a complexity level:

- Clarifying doubts about what the task involves
- Discussing if a task should be split or combined
- Exploring alternative approaches
- Understanding dependencies better

When presenting complexity options, remind the user they can select "Chat about this" or type a custom response.

## Why Context-Aware Options?

- Helps user understand what each level means **for this specific task**
- Allows suggesting "Skip" when a task might be redundant
- Provides recommendations based on task analysis
- Enables discussion via "Chat about this" option

## Interaction with Autonomy Level

Complexity and Autonomy Level combine to determine the effective workflow overhead:

| Combination | Effect |
|-------------|--------|
| Simple + Any Level | Lite ticket, no spec/plan/QA (branch → lite ticket → TDD → commit → PR + merge checklist) |
| Standard + L1 | Maximum oversight (5 checkpoints) |
| Standard + L2 | Balanced (Plan + Merge checkpoints only) |
| Standard + L3-4 | Fast execution, quality gates + QA still enforced |
| Complex + L1 | Full ceremony (all checkpoints + QA + ADR) |
| Complex + L3-4 | Fast but with QA engineer + ADR |
| Any + L5 | Same as L4 per feature, but PM Orchestrator auto-sequences features via `start pm` |

**Note:** The user can override the autonomy level per-task. E.g., "use level 1 for this task" forces all checkpoints regardless of the project-level setting.

## Generic Fallback (only if no context available)

```
- Simple (install library, basic config, copy template)
- Standard (new endpoint, component, small feature)
- Complex (complete feature, significant refactor, external integration)
```
