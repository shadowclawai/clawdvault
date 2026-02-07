/**
 * Fix candle data to match correct prices from reserves
 * Run: DATABASE_URL="..." npx ts-node scripts/fix-candles.ts
 */

import { PrismaClient, Prisma } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Create connection pool using DIRECT_URL for migrations/scripts
const pool = new Pool({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TOTAL_SUPPLY = 1_073_000_000;

async function main() {
  console.log('🕯️ Fixing candle data...\n');

  // Get all tokens
  const tokens = await prisma.token.findMany({
    select: {
      id: true,
      mint: true,
      virtualSolReserves: true,
      virtualTokenReserves: true,
    },
  });

  console.log(`Found ${tokens.length} tokens\n`);

  for (const token of tokens) {
    console.log(`\n🔸 Token: ${token.mint}`);
    
    // Get current price from reserves
    const solReserves = Number(token.virtualSolReserves);
    const tokenReserves = Number(token.virtualTokenReserves);
    const currentPrice = solReserves / tokenReserves;
    const currentMarketCap = currentPrice * TOTAL_SUPPLY;
    
    console.log(`   Current price: ${currentPrice.toFixed(9)} SOL`);
    console.log(`   Market cap: ${currentMarketCap.toFixed(2)} SOL`);

    // Get latest candle
    const latestCandle = await prisma.priceCandle.findFirst({
      where: { tokenMint: token.mint },
      orderBy: { bucketTime: 'desc' },
    });

    if (latestCandle) {
      const candlePrice = Number(latestCandle.close);
      const diff = Math.abs(candlePrice - currentPrice) / currentPrice * 100;
      
      console.log(`   Latest candle: ${candlePrice.toFixed(9)} SOL (${latestCandle.interval} @ ${latestCandle.bucketTime.toISOString()})`);
      
      if (diff > 5) {
        console.log(`   ⚠️  Price mismatch: ${diff.toFixed(1)}% difference`);
      } else {
        console.log(`   ✓ Price matches within ${diff.toFixed(2)}%`);
      }
    } else {
      console.log(`   ⚠️  No candles found`);
    }
  }

  console.log('\n✅ Done!\n');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
