/**
 * Backfill candles from existing trades
 * 
 * Safe to run multiple times - will update existing candles correctly
 * 
 * Usage:
 *   DIRECT_URL="postgresql://..." npx ts-node scripts/backfill-candles.ts
 * 
 * Or for local:
 *   npx ts-node scripts/backfill-candles.ts
 */

import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { Decimal } from '../generated/prisma/internal/prismaNamespace';

// Create connection pool using DIRECT_URL for migrations/scripts
const pool = new Pool({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

type CandleInterval = '1m' | '5m' | '15m' | '1h' | '1d';

const INTERVAL_MS: Record<CandleInterval, number> = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

function getBucketTime(timestamp: Date, interval: CandleInterval): Date {
  const ms = INTERVAL_MS[interval];
  const bucketMs = Math.floor(timestamp.getTime() / ms) * ms;
  return new Date(bucketMs);
}

async function backfillCandles() {
  console.log('🕯️ Starting candle backfill...\n');
  
  // Fetch all trades ordered by time
  const trades = await prisma.trade.findMany({
    orderBy: { createdAt: 'asc' },
    include: { token: true },
  });
  
  console.log(`Found ${trades.length} trades to process\n`);
  
  if (trades.length === 0) {
    console.log('No trades found, nothing to backfill');
    return;
  }
  
  const intervals: CandleInterval[] = ['1m', '5m', '15m', '1h', '1d'];
  let created = 0;
  let updated = 0;
  
  for (const trade of trades) {
    const price = trade.priceSol;
    const volume = trade.solAmount;
    const timestamp = trade.createdAt;
    const tokenMint = trade.tokenMint;
    
    console.log(`Processing trade ${trade.id.slice(0, 8)}... (${trade.tradeType} ${tokenMint.slice(0, 8)}...)`);
    
    for (const interval of intervals) {
      const bucketTime = getBucketTime(timestamp, interval);
      
      // Try to find existing candle
      const existing = await prisma.priceCandle.findUnique({
        where: {
          tokenMint_interval_bucketTime: {
            tokenMint,
            interval,
            bucketTime,
          },
        },
      });
      
      if (existing) {
        // Update existing candle
        await prisma.priceCandle.update({
          where: {
            tokenMint_interval_bucketTime: {
              tokenMint,
              interval,
              bucketTime,
            },
          },
          data: {
            high: price.gt(existing.high) ? price : existing.high,
            low: price.lt(existing.low) ? price : existing.low,
            close: price,
            volume: existing.volume.add(volume),
            trades: { increment: 1 },
          },
        });
        updated++;
      } else {
        // Create new candle
        await prisma.priceCandle.create({
          data: {
            tokenMint,
            interval,
            bucketTime,
            open: price,
            high: price,
            low: price,
            close: price,
            volume: volume,
            trades: 1,
          },
        });
        created++;
      }
    }
  }
  
  console.log(`\n✅ Backfill complete!`);
  console.log(`   Created: ${created} candles`);
  console.log(`   Updated: ${updated} candles`);
}

// Run it
backfillCandles()
  .catch((e) => {
    console.error('❌ Backfill failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
