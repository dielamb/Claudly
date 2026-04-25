#!/usr/bin/env bash
set -euo pipefail

echo "Running portfolio maintenance check..."
"__HOME__/.claude/helpers/nightly-maintenance.sh"
echo "Done. Report: __HOME__/Desktop/Labirynt/3 Atlas/Domains/portfolio/drift-reports/$(date +%Y-%m-%d).md"
