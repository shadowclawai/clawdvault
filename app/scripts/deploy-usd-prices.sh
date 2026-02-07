#!/bin/bash
# Production Deployment Script for USD Price Tracking
# 
# This script:
# 1. Backs up existing data
# 2. Applies Prisma migration
# 3. Runs backfill for historical data
#
# Usage: ./scripts/deploy-usd-prices.sh

set -e

echo "🚀 ClawdVault USD Price Migration"
echo "=================================="
echo ""

# Check for DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    echo "❌ Error: DATABASE_URL environment variable not set"
    exit 1
fi

# Check for Helius API key (needed for backfill)
if [ -z "$HELIUS_API_KEY" ]; then
    echo "⚠️  Warning: HELIUS_API_KEY not set. Historical backfill may not work."
fi

echo "📋 Pre-deployment checklist:"
echo "   - Database URL: ${DATABASE_URL:0:30}..."
echo "   - Backup will be created before migration"
echo ""

read -p "Continue? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted."
    exit 1
fi

echo ""
echo "🔒 Step 1: Creating backup..."
chmod +x ./scripts/backup-before-usd-migration.sh
./scripts/backup-before-usd-migration.sh

echo ""
echo "🔄 Step 2: Applying Prisma migration..."
npx prisma db push

echo ""
echo "📊 Step 3: Running backfill script..."
echo "   (This will take time - limited by CoinGecko API rate limits)"
npx ts-node ./scripts/backfill-usd-prices.ts

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📋 Summary:"
echo "   - Schema updated with USD fields"
echo "   - Historical data backfilled (partial)"
echo "   - New trades will capture SOL price automatically"
echo ""
echo "⚠️  Note: Complete historical backfill may take hours."
echo "   Run backfill-usd-prices.ts multiple times to process all data."
