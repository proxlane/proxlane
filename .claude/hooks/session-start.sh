#!/bin/bash
# Print the project state file at session start, so "always in context" is true by
# mechanism rather than by assertion. Kept trivial: it is a file read.
set -euo pipefail

STATE="${CLAUDE_PROJECT_DIR:-.}/docs/state.md"

if [ -f "$STATE" ]; then
  cat "$STATE"
else
  echo "docs/state.md is missing. It is the one file every session should start from."
fi
