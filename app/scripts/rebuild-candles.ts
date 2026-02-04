/**
 * Completely rebuild candle data from trades (all intervals)
 */

import { PrismaClient } from '@prisma/client';

const INTERVALS = ['1m', '5m', '15m', '1h', '1d'] as const;
const INTERVAL_MS: Record<string, number> = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

function getBucketTime(timestamp: Date, interval: string): Date {
  const ms = INTERVAL_MS[interval];
  const bucketMs = Math.floor(timestamp.getTime() / ms) * ms;
  return new Date(bucketMs);
}

async function main() {
  const prisma = new PrismaClient();

  console.log('🕯️ Rebuilding all candle data...\n');

  const deleted = await prisma.priceCandle.deleteMany({});
  console.log(`Deleted ${deleted.count} existing candles\n`);

  const tokens = await prisma.token.findMany();
  
  for (const token of tokens) {
    console.log(`\n${token.symbol}:`);
    
    const virtualSol = Number(token.virtualSolReserves);
    const virtualTokens = Number(token.virtualTokenReserves);
    const currentPrice = virtualSol / virtualTokens;
    
    const trades = await prisma.trade.findMany({
      where: { tokenMint: token.mint },
      orderBy: { createdAt: 'asc' },
    });
    
    console.log(`  ${trades.length} trades, price: ${currentPrice.toFixed(12)}`);
    
    let totalCandles = 0;
    
    for (const interval of INTERVALS) {
      const candleMap = new Map<string, any>();
      
      for (const trade of trades) {
        const price = Number(trade.priceSol);
        const volume = Number(trade.solAmount);
        const bucket = getBucketTime(trade.createdAt, interval);
        const key = bucket.toISOString();
        
        const existing = candleMap.get(key);
        if (existing) {
          existing.high = Math.max(existing.high, price);
          existing.low = Math.min(existing.low, price);
          existing.close = price;
          existing.volume += volume;
          existing.trades += 1;
        } else {
          candleMap.set(key, {
            open: price, high: price, low: price, close: price,
            volume, trades: 1, bucket,
          });
        }
      }
      
      // If no trades, create one candle at current price
      if (candleMap.size === 0) {
        const bucket = getBucketTime(new Date(), interval);
        candleMap.set(bucket.toISOString(), {
          open: currentPrice, high: currentPrice, low: currentPrice, close: currentPrice,
          volume: 0, trades: 0, bucket,
        });
      }
      
      // Insert candles
      for (const c of Array.from(candleMap.values())) {
        await prisma.priceCandle.create({
          data: {
            tokenMint: token.mint,
            interval,
            bucketTime: c.bucket,
            open: c.open, high: c.high, low: c.low, close: c.close,
            volume: c.volume, trades: c.trades,
          },
        });
        totalCandles++;
      }
    }
    
    console.log(`  ✅ Created ${totalCandles} candles`);
  }

  console.log('\n🕯️ Done!');
  await prisma.$disconnect();
}

main().catch(console.error);
