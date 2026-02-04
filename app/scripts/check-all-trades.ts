import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  
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
