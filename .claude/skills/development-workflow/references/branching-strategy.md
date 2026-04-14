# Branching Strategy — Extended Guide

For branch tables and merge strategy, see `base-standards.mdc` § Git Conventions.

## Visual Flows

### GitHub Flow

```
main ────●────●────●────●────●──── (always deployable)
          \  /      \  /
           \/        \/
        feature/   feature/
        F001       F002
                         tag: v0.1.0
```

### GitFlow

```
main ─────●──────────────────●──── (releases only)
           \                /
develop ────●──●──●──●──●──●───── (integration)
             \  /  \  /
              \/    \/
           feature  feature
                     \
                   release/v1.0
```

## Decision Guide

| Question | GitHub Flow | GitFlow |
|----------|:-----------:|:-------:|
| Solo dev or small team? | Yes | |
| MVP / early stage? | Yes | |
| Continuous deployment? | Yes | |
| Multiple devs in parallel? | | Yes |
| Formal release cycles? | | Yes |
| Staging + QA environment? | | Yes |

**Start with GitHub Flow. Switch to GitFlow when you need a `develop` branch.**

## Migrating GitHub Flow → GitFlow

1. Update `key_facts.md`: `branching-strategy: gitflow`
2. Create develop: `git checkout main && git pull && git checkout -b develop && git push -u origin develop`
3. Set develop as default branch in GitHub settings
4. Protect both `main` and `develop`
5. All new feature branches base from `develop`

## Tag Convention

`vMAJOR.MINOR.PATCH` — Breaking=MAJOR, Feature=MINOR, Fix=PATCH, Pre-release=`-beta.1`

## Branch Protection (Recommended)

- **GitHub Flow** — `main`: require PR, require status checks (tests/lint/build), require 1 approval
- **GitFlow** — `main`: same + no direct push. `develop`: require PR + status checks
