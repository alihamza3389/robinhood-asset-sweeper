#!/usr/bin/env bash
# One-click launcher for Linux / macOS. Any arguments are passed through (e.g. ./run.sh --dry-run).
set -e
cd "$(dirname "$0")"

echo "Robinhood Chain Asset Sweeper v3 Rework"
echo

if ! command -v node >/dev/null 2>&1; then
    echo "Node.js is not installed. Install the LTS version from https://nodejs.org and run this again."
    exit 1
fi

major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$major" -lt 20 ]; then
    echo "Node.js $(node -v) is too old. Please install version 20 or newer from https://nodejs.org"
    exit 1
fi

if [ ! -d node_modules ]; then
    echo "First run: installing packages (this takes a few seconds)..."
    npm install --no-audit --no-fund
    echo
fi

node --import tsx src/index.ts "$@"
