# Architectural Decisions Template

This file demonstrates the format for logging architectural decisions (ADRs). Use bullet lists for clarity.

## Format

Each decision should include:
- Date and ADR number
- Context (why the decision was needed)
- Decision (what was chosen)
- Alternatives considered
- Consequences (trade-offs, implications)

## Example Entries

### ADR-001: Use PostgreSQL as Primary Database (2025-01-10)

**Context:**
- Need relational database for structured data
- Multiple entities with complex relationships
- Need ACID transactions for order processing

**Decision:**
- Use PostgreSQL as the primary database
- Use an ORM for type-safe database access

**Alternatives Considered:**
- MongoDB → Rejected: relational data model fits better
- MySQL → Rejected: PostgreSQL has better JSON support and extensibility
- SQLite → Rejected: not suitable for production multi-user workloads

**Consequences:**
- Better data integrity with foreign keys and constraints
- Rich query capabilities including JSON operations
- Requires managed database service for production
- Team needs PostgreSQL knowledge

### ADR-002: Use JWT for Authentication (2025-01-12)

**Context:**
- Need stateless authentication for API
- Support multiple client types (web, mobile)
- Want to avoid server-side session storage

**Decision:**
- Use JWT tokens with short-lived access tokens and refresh token rotation
- Store tokens securely (httpOnly cookies for web)

**Alternatives Considered:**
- Session-based auth → Rejected: requires server-side state, harder to scale
- OAuth2 only → Rejected: overkill for single-app auth, adds complexity
- API keys → Rejected: not suitable for user-facing authentication

**Consequences:**
- Stateless: easy to scale horizontally
- Self-contained: token carries user info
- Must handle token refresh and rotation
- Must protect against XSS/CSRF

## Tips

- Number decisions sequentially (ADR-001, ADR-002, etc.)
- Always include date for context
- Be honest about trade-offs (use pros and cons)
- Keep alternatives brief but clear
- Update decisions if they're revisited/changed
- Focus on "why" not "how" (implementation details go elsewhere)
