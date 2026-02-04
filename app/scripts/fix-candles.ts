/**
 * Fix candle data to match correct prices from reserves
 * Run: DATABASE_URL="..." npx ts-node scripts/fix-candles.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';

const TOTAL_SUPPLY = 1_073_000_000;

async function main() {
  const prisma = new PrismaClient();

  console.log('🕯️ Fixing candle data...\n');

  // Get all tokens with their current reserves
  const tokens = await prisma.token.findMany();
  
  for (const token of tokens) {
    const virtualSol = Number(token.virtualSolReserves);
    const virtualTokens = Number(token.virtualTokenReserves);
    const correctPrice = virtualSol / virtualTokens;
    
    console.log(`\n${token.symbol}: correct price = ${correctPrice.toFixed(12)}`);
    
    // Get all candles for this token
    const candles = await prisma.priceCandle.findMany({
      where: { tokenMint: token.mint },
      orderBy: { bucketTime: 'desc' },
    });
    
    if (candles.length === 0) {
      console.log(`  No candles found`);
      continue;
    }
    
    // Check if latest candle price is way off
    const latestCandle = candles[0];
    const candlePrice = Number(latestCandle.close);
    const priceDiff = Math.abs(candlePrice - correctPrice) / correctPrice;
    
    console.log(`  Latest candle close: ${candlePrice.toFixed(12)}`);
    console.log(`  Difference: ${(priceDiff * 100).toFixed(2)}%`);
    
    if (priceDiff > 0.01) { // More than 1% off
      console.log(`  ⚠️ Price is off by more than 1%, fixing all candles...`);
      
      // Get trades to rebuild candles
      const trades = await prisma.trade.findMany({
        where: { tokenMint: token.mint },
        orderBy: { createdAt: 'asc' },
      });
      
      if (trades.length === 0) {
        // No trades, just update candle to correct price
        await prisma.priceCandle.updateMany({
          where: { tokenMint: token.mint },
          data: {
            open: correctPrice,
            high: correctPrice,
            low: correctPrice,
            close: correctPrice,
          },
        });
        console.log(`  ✅ Updated ${candles.length} candles to correct price (no trades)`);
      } else {
        // Delete old candles and let them rebuild naturally
        // Or just update latest to correct price
        await prisma.priceCandle.updateMany({
          where: { tokenMint: token.mint },
          data: {
            close: correctPrice,
          },
        });
        console.log(`  ✅ Updated close price on ${candles.length} candles`);
      }
    } else {
      console.log(`  ✓ Price is within 1%, skipping`);
    }
  }

  console.log('\n🕯️ Done!');
  await prisma.$disconnect();
}

main().catch(console.error);
