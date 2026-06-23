#!/bin/bash
set -e
pnpm install --frozen-lockfile
# drizzle-kit push uses an Ink/clack TUI that hangs in non-TTY CI environments.
# push-ci uses the drizzle-kit programmatic API (no TUI, fully non-interactive).
pnpm --filter @workspace/db run push-ci
