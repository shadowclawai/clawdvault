import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Create connection pool using DIRECT_URL for migrations/scripts
const pool = new Pool({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

(async () => {
  const trades = await prisma.trade.findMany({ orderBy: { createdAt: 'asc' } });
  for (const t of trades) {
    console.log(`${t.tokenMint.slice(0,8)}... | ${t.tradeType} | ${Number(t.solAmount).toFixed(2)} SOL | ${t.createdAt.toISOString().slice(0,16)}`);
  }
  console.log(`\nTotal: ${trades.length} trades`);
  await prisma.$disconnect();
})();
