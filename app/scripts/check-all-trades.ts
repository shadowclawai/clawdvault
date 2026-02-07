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
  
  const trades = await prisma.trade.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20
  });
  
  console.log(`Total trades in DB: ${trades.length}\n`);
  trades.forEach((t, i) => {
    console.log(`${i+1}. ${t.tokenMint.slice(0,8)}... | ${t.tradeType.toUpperCase().padEnd(4)} | ${Number(t.solAmount).toFixed(4)} SOL | price: ${Number(t.priceSol).toExponential(4)}`);
  });
  
  await prisma.$disconnect();
}
main();
