#!/bin/bash
# =============================================================================
# Synology NAS Automated Production Deployment Script
# =============================================================================
#
# This script handles code dependency installation, codebase build validation,
# non-interactive database migrations, and graceful restart of the Docker containers.
#
# Usage:
#   chmod +x deploy-synology.sh
#   ./deploy-synology.sh
# =============================================================================

set -e

echo "====================================================================="
echo "🚀 Starting Production Deployment on Synology NAS..."
echo "====================================================================="

# Load environment variables if .env file exists
if [ -f .env ]; then
  echo "🔑 Loading environment variables from .env..."
  export $(grep -v '^#' .env | xargs)
fi

# 1. Install dependencies
echo -e "\n📦 Step 1: Installing workspace dependencies..."
pnpm install --frozen-lockfile --ignore-scripts

# 2. Build validation
echo -e "\n🛠️  Step 2: Building codebase (typechecks and compilations)..."
pnpm run build

# 3. Run Database Migrations
echo -e "\n🗄️  Step 3: Running database migrations (non-interactive)..."
pnpm db:deploy

# 4. Restart Docker Stack
echo -e "\n🐋 Step 4: Rebuilding and restarting Docker containers..."
if command -v docker-compose &> /dev/null; then
  docker-compose up -d --build
elif command -v docker &> /dev/null && docker compose version &> /dev/null; then
  docker compose up -d --build
else
  echo "⚠️  Warning: Neither 'docker compose' nor 'docker-compose' command was found."
  echo "Please restart your Docker stack manually via Synology Container Manager."
fi

echo -e "\n====================================================================="
echo "✅ Deployment completed successfully!"
echo "====================================================================="
