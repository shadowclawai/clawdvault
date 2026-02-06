# USD Price Tracking for Trades and Candles

## Summary
Adds USD price tracking to trades and candles by capturing SOL/USD price at trade time. This allows for:
- USD-denominated trade values
- USD price charts
- Accurate portfolio valuations over time

## Changes

### Database Schema (prisma/schema.prisma)

**Trade model:**
- Added `solPriceUsd` field to store SOL price at trade time

**PriceCandle model:**
- Added `solPriceUsd` - SOL price used for calculations
- Added `openUsd`, `highUsd`, `lowUsd`, `closeUsd` - USD OHLCV values
- Added `volumeUsd` - USD volume

### New Files

1. **`src/lib/sol-price.ts`** - SOL price fetching utility
   - Caches price for 60 seconds
   - Uses CoinGecko with Jupiter fallback

2. **`src/lib/candles.ts`** (updated)
   - Now accepts optional `solPriceUsd` parameter
   - Calculates and stores USD OHLCV values
   - Added `getUsdCandles()` function for USD-denominated charts

3. **`src/lib/db.ts`** (updated)
   - `recordTrade()` now fetches SOL price and stores it
   - Passes SOL price to candle update

4. **`src/lib/types.ts`** (updated)
   - Added `price_usd` and `sol_price_usd` to Trade interface

### Migration Scripts

5. **`scripts/backup-before-usd-migration.sh`** - Production backup script
   - Backs up `trades` and `price_candles` tables
   - Creates timestamped backup directory
   - Includes restore instructions

6. **`scripts/backfill-usd-prices.ts`** - Historical data backfill
   - Fetches historical SOL prices from CoinGecko
   - Updates trades with `sol_price_usd`
   - Updates candles with USD OHLCV values
   - Respects API rate limits (2s delay between calls)

7. **`scripts/deploy-usd-prices.sh`** - Production deployment script
   - Runs backup → migration → backfill in sequence
   - Interactive confirmation

## Deployment Steps

### 1. Backup Production Data
```bash
cd app
export DATABASE_URL="postgresql://..."
./scripts/backup-before-usd-migration.sh
```

### 2. Apply Schema Changes
```bash
npx prisma db push
```

### 3. Backfill Historical Data
```bash
npx ts-node scripts/backfill-usd-prices.ts
```

**Note:** This is rate-limited by CoinGecko's free tier (~30 calls/minute). For large datasets, consider:
- Running the script multiple times (it skips already-processed records)
- Using a CoinGecko paid API key for higher limits

### 4. Or use the deployment script
```bash
./scripts/deploy-usd-prices.sh
```

## Backwards Compatibility

- All new fields are nullable (`?`) in Prisma schema
- Existing trades and candles work without USD data
- New trades automatically capture SOL price
- Candles gracefully handle missing USD data

## Testing

1. Create a new trade and verify `sol_price_usd` is populated
2. Check that candles have USD fields populated
3. Verify existing data still works without USD values

## API Changes

The Trade type now includes:
```typescript
{
  ...existing fields,
  sol_price_usd?: number;  // SOL price at trade time
  price_usd?: number;      // Derived: price_sol * sol_price_usd
}
```

New candle endpoint (if added):
```typescript
GET /api/candles/[mint]/usd?interval=5m&limit=100
```

## Notes

- SOL price is fetched at trade time and stored with the trade
- Candles use the trade's SOL price for USD calculations
- USD values are approximate (based on SOL price at trade time)
- Consider adding a `candles/usd` API endpoint for USD chart data
