import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  
  const token = await prisma.token.findFirst({ where: { symbol: 'CLAWDVAULT' }});
  console.log('Token reserves:', {
    virtualSol: Number(token?.virtualSolReserves),
    virtualTokens: Number(token?.virtualTokenReserves),
    calculatedPrice: Number(token?.virtualSolReserves) / Number(token?.virtualTokenReserves),
  });
  
  const trades = await prisma.trade.findMany({ 
    where: { tokenMint: token?.mint },
    take: 5,
    orderBy: { createdAt: 'desc' }
  });
  console.log('\nRecent trades priceSol:');
  trades.forEach(t => console.log(`  ${t.tradeType}: ${Number(t.priceSol)}`));
  
  const candles = await prisma.priceCandle.findMany({
    where: { tokenMint: token?.mint, interval: '5m' },
    take: 3,
    orderBy: { bucketTime: 'desc' }
  });
  console.log('\nCandle values:');
  candles.forEach(c => console.log(`  O:${Number(c.open)} H:${Number(c.high)} L:${Number(c.low)} C:${Number(c.close)}`));
  
  await prisma.$disconnect();
}
main();
