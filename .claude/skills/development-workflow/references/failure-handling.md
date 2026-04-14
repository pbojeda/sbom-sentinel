# Failure Handling & Rollback Guide

## Types of Failures

| Failure Type | When It Happens | Severity |
|--------------|-----------------|----------|
| Test Failure | Tests don't pass | Medium |
| Validation Failure | production-code-validator finds issues | Medium |
| Build Failure | Code doesn't compile | High |
| Dependency Block | Waiting on another task | Low |
| External Block | Waiting on external resource | Medium |
| Critical Bug | Discovered during development | High |
| Scope Creep | Task is bigger than expected | Medium |

---

## Failure Recovery Procedures

### Test Failure

**Recovery:**
1. **Identify** failing tests
2. **Analyze** root cause
3. **Fix** the code (not the test, unless test is wrong)
4. **Re-run** all tests
5. **Continue** workflow

**Do NOT:**
- Skip failing tests
- Delete tests to make them pass
- Disable tests temporarily

---

### Validation Failure (production-code-validator)

**Recovery:**
1. **Review** all issues reported
2. **Prioritize** by severity (CRITICAL first)
3. **Fix** each issue
4. **Re-run** validator
5. **Continue** only when clean

**Common Fixes:**

| Issue | Fix |
|-------|-----|
| console.log | Remove or use proper logger |
| TODO/FIXME | Complete the task or create new ticket |
| Hardcoded URL | Use environment variable |
| Hardcoded secret | Use secrets manager |
| Empty catch block | Add proper error handling |

---

### Build/Compile Failure

**Recovery:**
1. **Read** error messages carefully
2. **Fix** type errors first
3. **Check** imports and paths
4. **Rebuild** incrementally
5. **Run** tests after fix

---

### Dependency Block

**Recovery:**
1. **Identify** the blocking task/resource
2. **Document** the block in product tracker "Active Session" section
3. **Options:**
   - Wait for blocker to resolve
   - Switch to different task
   - Create mock/stub to continue

**Update product tracker:**
- Change feature status to Blocked

---

### Critical Bug Discovered

**Recovery:**
1. **Document** the bug immediately
2. **Assess** impact and priority
3. **Decide:**
   - Fix now (if blocking current task)
   - Create ticket for later (if not blocking)
4. **If fixing:** Complete fix before continuing task

**Update bugs.md** with the new bug entry.

---

### Scope Creep

**Recovery:**
1. **Stop** expanding scope
2. **Document** what was discovered
3. **Options:**
   - Complete minimal viable task
   - Split into multiple tasks
   - Discuss with team

---

## Rollback Procedures

### When to Rollback

- Breaking changes merged to main
- Critical bug in production
- Failed deployment
- Data corruption

### Git Rollback

**Undo last commit (not pushed):**
```bash
git reset --soft HEAD~1  # Keep changes staged
git reset --hard HEAD~1  # Discard changes
```

**Revert pushed commit:**
```bash
git revert <commit-hash>
git push
```

### Database Rollback

<!-- CONFIG: Adjust for your ORM -->
```bash
npx prisma migrate reset  # Reset to initial state
npx prisma migrate deploy # Reapply migrations
```

---

## Status Codes Reference

| Status | Meaning | Action |
|--------|---------|--------|
| In Progress | Normal work | Continue |
| Paused | Temporarily stopped | Can resume |
| Blocked | Waiting on dependency | Resolve block |
| Failed | Critical failure | Rollback/fix |
| Abandoned | No longer needed | Clean up |
| Completed | Successfully done | Next task |

---

## Prevention Strategies

### Avoid Test Failures
- Write tests first (TDD)
- Run tests frequently
- Use watch mode during development

### Avoid Validation Failures
- Use linter during development
- Check code before commit
- Follow code standards from start

### Avoid Blocks
- Check dependencies before starting
- Communicate with team early
- Use mocks when possible

### Avoid Scope Creep
- Understand requirements fully before starting
- Ask questions early
- Timebox exploration
