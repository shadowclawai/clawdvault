#!/bin/bash
# Backup script for trades and price_candles tables before USD price migration
# Run this BEFORE applying the Prisma migration in production

set -e

echo "🔒 ClawdVault Production Backup Script"
echo "======================================"
echo ""

# Check for required env var
if [ -z "$DATABASE_URL" ]; then
    echo "❌ Error: DATABASE_URL environment variable not set"
    echo "   Set it with: export DATABASE_URL='postgresql://...'"
    exit 1
fi

# Generate timestamp for backup
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="./backups/${TIMESTAMP}"

echo "📁 Creating backup directory: ${BACKUP_DIR}"
mkdir -p "${BACKUP_DIR}"

echo ""
echo "📊 Backing up tables..."
echo ""

# Backup trades table
echo "   💾 Backing up 'trades' table..."
psql "${DATABASE_URL}" -c "\COPY (SELECT * FROM trades) TO '${BACKUP_DIR}/trades_backup.csv' WITH CSV HEADER;"
echo "      ✓ trades_backup.csv created"

# Backup price_candles table
echo "   💾 Backing up 'price_candles' table..."
psql "${DATABASE_URL}" -c "\COPY (SELECT * FROM price_candles) TO '${BACKUP_DIR}/price_candles_backup.csv' WITH CSV HEADER;"
echo "      ✓ price_candles_backup.csv created"

# Backup schema
echo "   💾 Backing up schema..."
pg_dump --schema-only "${DATABASE_URL}" > "${BACKUP_DIR}/schema_backup.sql"
echo "      ✓ schema_backup.sql created"

# Create metadata file
echo "   📝 Creating backup metadata..."
cat > "${BACKUP_DIR}/metadata.json" << EOF
{
  "timestamp": "${TIMESTAMP}",
  "date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "backup_version": "1.0",
  "tables_backed_up": ["trades", "price_candles"],
  "migration": "usd-price-tracking",
  "notes": "Backup before adding sol_price_usd to trades and USD OHLCV fields to price_candles"
}
EOF
echo "      ✓ metadata.json created"

echo ""
echo "✅ Backup complete!"
echo ""
echo "📂 Backup location: ${BACKUP_DIR}/"
echo ""
echo "To restore from this backup:"
echo "   psql \"\${DATABASE_URL}\" -c \"DELETE FROM trades;\""
echo "   psql \"\${DATABASE_URL}\" -c \"\\COPY trades FROM '${BACKUP_DIR}/trades_backup.csv' WITH CSV HEADER;\""
echo "   psql \"\${DATABASE_URL}\" -c \"DELETE FROM price_candles;\""
echo "   psql \"\${DATABASE_URL}\" -c \"\\COPY price_candles FROM '${BACKUP_DIR}/price_candles_backup.csv' WITH CSV HEADER;\""
echo ""
echo "⚠️  IMPORTANT: Store this backup securely. It contains all trade data."
