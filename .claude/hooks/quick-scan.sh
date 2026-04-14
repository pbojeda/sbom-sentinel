#!/usr/bin/env bash
# Quick scan for obvious issues after a developer agent finishes.
# This is a FAST check (~2s, no additional API calls). The full review happens in Step 5 (production-code-validator).
#
# Receives SubagentStop event JSON on stdin. Scans recently modified files for:
# - console.log / debugger statements
# - TODO / FIXME / HACK comments
# - Hardcoded localhost URLs
# - Empty catch blocks
# - Hardcoded secrets patterns
#
# Exit codes: 0 = pass (or warnings), 2 = blocked (critical issues found)

set -euo pipefail

# Verify jq is installed (required for parsing hook JSON input)
if ! command -v jq &> /dev/null; then
  echo '{"systemMessage": "Quick scan skipped: jq is not installed. Install it with: brew install jq (macOS) or apt install jq (Linux)."}' >&2
  exit 0
fi

INPUT=$(cat)

# Extract working directory from hook input
CWD=$(echo "$INPUT" | jq -r '.cwd // "."')

# Find files modified in the last 5 minutes (covers the developer agent's work)
MODIFIED_FILES=$(find "$CWD/backend" "$CWD/frontend" "$CWD/shared" \
  -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \) \
  -not -path "*/node_modules/*" \
  -not -path "*/.next/*" \
  -not -path "*/dist/*" \
  -not -name "*.test.*" \
  -not -name "*.spec.*" \
  -newer "$CWD/.claude/settings.json" \
  2>/dev/null || true)

# If no modified files found, try git diff instead
if [ -z "$MODIFIED_FILES" ]; then
  MODIFIED_FILES=$(cd "$CWD" && git diff --name-only HEAD 2>/dev/null | grep -E '\.(ts|tsx|js|jsx)$' | grep -v -E '(\.test\.|\.spec\.|node_modules)' || true)
  # Prepend CWD to make paths absolute
  if [ -n "$MODIFIED_FILES" ]; then
    MODIFIED_FILES=$(echo "$MODIFIED_FILES" | sed "s|^|$CWD/|")
  fi
fi

if [ -z "$MODIFIED_FILES" ]; then
  echo '{"systemMessage": "Quick scan: no modified source files found to scan."}'
  exit 0
fi

ISSUES=""
CRITICAL=0
WARNING=0

while IFS= read -r file; do
  [ -f "$file" ] || continue
  RELATIVE=$(echo "$file" | sed "s|$CWD/||")

  # console.log / console.debug (not console.error/warn which are intentional)
  MATCHES=$(grep -n 'console\.\(log\|debug\)' "$file" 2>/dev/null || true)
  if [ -n "$MATCHES" ]; then
    WARNING=$((WARNING + $(echo "$MATCHES" | wc -l)))
    ISSUES="$ISSUES\n[WARN] $RELATIVE: console.log/debug found"
  fi

  # debugger statements
  MATCHES=$(grep -n '^\s*debugger' "$file" 2>/dev/null || true)
  if [ -n "$MATCHES" ]; then
    CRITICAL=$((CRITICAL + $(echo "$MATCHES" | wc -l)))
    ISSUES="$ISSUES\n[CRITICAL] $RELATIVE: debugger statement found"
  fi

  # TODO / FIXME / HACK / XXX
  MATCHES=$(grep -n '\(TODO\|FIXME\|HACK\|XXX\)' "$file" 2>/dev/null || true)
  if [ -n "$MATCHES" ]; then
    WARNING=$((WARNING + $(echo "$MATCHES" | wc -l)))
    ISSUES="$ISSUES\n[WARN] $RELATIVE: TODO/FIXME comments found"
  fi

  # Hardcoded localhost
  MATCHES=$(grep -n 'localhost\|127\.0\.0\.1' "$file" 2>/dev/null | grep -v '// config\|\.env\|process\.env' || true)
  if [ -n "$MATCHES" ]; then
    WARNING=$((WARNING + $(echo "$MATCHES" | wc -l)))
    ISSUES="$ISSUES\n[WARN] $RELATIVE: hardcoded localhost reference"
  fi

  # Potential hardcoded secrets (API keys, tokens — snake_case and camelCase)
  MATCHES=$(grep -n -iE '\b(api_key|api_secret|password|secret_key|apiKey|apiSecret|secretKey|aws_secret|privateKey|private_key)\s*[=:]\s*["\x27][^"\x27]*["\x27]' "$file" 2>/dev/null || true)
  if [ -n "$MATCHES" ]; then
    CRITICAL=$((CRITICAL + $(echo "$MATCHES" | wc -l)))
    ISSUES="$ISSUES\n[CRITICAL] $RELATIVE: potential hardcoded secret"
  fi

done <<< "$MODIFIED_FILES"

# Build result
FILE_COUNT=$(echo "$MODIFIED_FILES" | wc -l | tr -d ' ')

if [ $CRITICAL -gt 0 ]; then
  MSG="Quick scan ($FILE_COUNT files): $CRITICAL CRITICAL + $WARNING warnings found.\n$ISSUES\n\nFix critical issues before proceeding."
  echo "{\"systemMessage\": \"$(echo -e "$MSG" | sed 's/"/\\"/g' | tr '\n' ' ')\"}"
  exit 2
elif [ $WARNING -gt 0 ]; then
  MSG="Quick scan ($FILE_COUNT files): $WARNING warnings found (non-blocking).\n$ISSUES\n\nThese will be reviewed in detail during Step 5 (Finalize)."
  echo "{\"systemMessage\": \"$(echo -e "$MSG" | sed 's/"/\\"/g' | tr '\n' ' ')\"}"
  exit 0
else
  echo "{\"systemMessage\": \"Quick scan ($FILE_COUNT files): clean. No obvious issues detected.\"}"
  exit 0
fi
