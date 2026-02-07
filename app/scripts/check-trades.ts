import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

async function main() {
  // Create connection pool using DIRECT_URL for migrations/scripts
const pool = new Pool({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
  
  const token = await prisma.token.findFirst({ where: { symbol: 'CLAWDVAULT' }});
  
  const trades = await prisma.trade.findMany({ 
    where: { tokenMint: token?.mint },
    orderBy: { createdAt: 'asc' }  // oldest first
  });
  
  console.log('All CLAWDVAULT trades (chronological):');
  trades.forEach((t, i) => {
    console.log(`${i+1}. ${t.tradeType.toUpperCase().padEnd(4)} | ${Number(t.solAmount).toFixed(4)} SOL | price: ${Number(t.priceSol).toExponential(4)} | ${t.createdAt.toISOString()}`);
  });
  
  await prisma.$disconnect();
}
main();

// Also check current reserves
async function checkReserves() {
  // Create connection pool using DIRECT_URL for migrations/scripts
const pool = new Pool({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
  const token = await prisma.token.findFirst({ where: { symbol: 'CLAWDVAULT' }});
  console.log('\nCurrent token reserves:');
  console.log('  virtualSol:', Number(token?.virtualSolReserves));
  console.log('  virtualTokens:', Number(token?.virtualTokenReserves));
  console.log('  currentPrice:', Number(token?.virtualSolReserves) / Number(token?.virtualTokenReserves));
  await prisma.$disconnect();
}
checkReserves();
