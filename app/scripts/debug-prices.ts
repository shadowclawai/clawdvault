import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const TOTAL_SUPPLY = 1_073_000_000;
const SOL_PRICE_USD = 100; // approximate

async function main() {
  // Create connection pool using DIRECT_URL for migrations/scripts
const pool = new Pool({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
  
  const token = await prisma.token.findFirst({ where: { symbol: 'CLAWDVAULT' }});
  
  const virtualSol = Number(token?.virtualSolReserves);
  const virtualTokens = Number(token?.virtualTokenReserves);
  const priceSol = virtualSol / virtualTokens;
  const mcapSol = priceSol * TOTAL_SUPPLY;
  const mcapUsd = mcapSol * SOL_PRICE_USD;
  
  console.log('=== DB Token Data ===');
  console.log('virtualSol:', virtualSol);
  console.log('virtualTokens:', virtualTokens);
  console.log('priceSol:', priceSol);
  console.log('mcapSol:', mcapSol);
  console.log('mcapUsd (at $100/SOL):', mcapUsd);
  
  // Check candles
  const latestCandle = await prisma.priceCandle.findFirst({
    where: { tokenMint: token?.mint, interval: '5m' },
    orderBy: { bucketTime: 'desc' }
  });
  
  if (latestCandle) {
    const candlePrice = Number(latestCandle.close);
    const candleMcapSol = candlePrice * TOTAL_SUPPLY;
    const candleMcapUsd = candleMcapSol * SOL_PRICE_USD;
    
    console.log('\n=== Latest 5m Candle ===');
    console.log('close:', candlePrice);
    console.log('mcapSol:', candleMcapSol);
    console.log('mcapUsd:', candleMcapUsd);
  }
  
  await prisma.$disconnect();
}
main();
