/**
 * Rebuild candles from all trades
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

async function updateCandles(
  tokenMint: string,
  price: number | Decimal,
  solVolume: number | Decimal,
  timestamp: Date
): Promise<void> {
  const priceDecimal = new Decimal(price.toString());
  const volumeDecimal = new Decimal(solVolume.toString());
  
  const intervals: CandleInterval[] = ['1m', '5m', '15m', '1h', '1d'];
  
  await Promise.all(intervals.map(async (interval) => {
    const bucketTime = getBucketTime(timestamp, interval);
    
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
      await prisma.priceCandle.update({
        where: {
          tokenMint_interval_bucketTime: {
            tokenMint,
            interval,
            bucketTime,
          },
        },
        data: {
          high: priceDecimal.greaterThan(existing.high) ? priceDecimal : existing.high,
          low: priceDecimal.lessThan(existing.low) ? priceDecimal : existing.low,
          close: priceDecimal,
          volume: existing.volume.add(volumeDecimal),
          trades: { increment: 1 },
        },
      });
    } else {
      await prisma.priceCandle.create({
        data: {
          tokenMint,
          interval,
          bucketTime,
          open: priceDecimal,
          high: priceDecimal,
          low: priceDecimal,
          close: priceDecimal,
          volume: volumeDecimal,
          trades: 1,
        },
      });
    }
  }));
}

async function main() {
  // Clear existing candles
  console.log('Clearing existing candles...');
  await prisma.priceCandle.deleteMany({});
  
  // Get all trades ordered by time
  const trades = await prisma.trade.findMany({
    orderBy: { createdAt: 'asc' },
  });
  
  console.log(`Rebuilding candles for ${trades.length} trades...\n`);
  
  for (const trade of trades) {
    console.log(`  ${trade.tokenMint.slice(0,8)}... ${Number(trade.solAmount).toFixed(2)} SOL @ ${trade.createdAt.toISOString().slice(0,16)}`);
    await updateCandles(
      trade.tokenMint,
      trade.priceSol,
      trade.solAmount,
      trade.createdAt
    );
  }
  
  // Count candles
  const count = await prisma.priceCandle.count();
  console.log(`\n✅ Created ${count} candles!`);
  
  await prisma.$disconnect();
}

main().catch(console.error);
