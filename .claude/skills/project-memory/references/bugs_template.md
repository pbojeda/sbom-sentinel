# Bug Log Template

This file demonstrates the format for logging bugs and their solutions. Keep entries brief and chronological.

## Format

Each bug entry should include:
- Date (YYYY-MM-DD)
- Brief description of the bug/issue
- Solution or fix applied
- Any prevention notes (optional)

Use bullet lists for simplicity. Older entries can be manually removed when they become irrelevant.

## Example Entries

### 2025-01-15 - Docker Architecture Mismatch
- **Issue**: Container failing to start with "exec format error"
- **Root Cause**: Built on ARM64 Mac but deploying to AMD64 server
- **Solution**: Added `--platform linux/amd64` to docker build command
- **Prevention**: Always specify platform in Dockerfile and build scripts

### 2025-01-20 - Database Connection Pool Exhaustion
- **Issue**: API returning 500 errors under load
- **Root Cause**: Connection pool size too small (default 5)
- **Solution**: Increased pool size to 20 and max overflow to 10
- **Prevention**: Load test APIs before production deployment

### 2025-01-22 - CORS Headers Missing
- **Issue**: Frontend getting CORS errors when calling API
- **Root Cause**: CORS middleware not configured for frontend origin
- **Solution**: Added frontend URL to allowed origins list
- **Prevention**: Always configure CORS when setting up new API endpoints

## Tips

- Keep descriptions under 2-3 lines
- Focus on what was learned, not exhaustive details
- Include enough context for future reference
- Date entries so you know how recent the issue is
- Periodically clean out very old entries (6+ months)
