import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  
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
  const prisma = new PrismaClient();
  const token = await prisma.token.findFirst({ where: { symbol: 'CLAWDVAULT' }});
  console.log('\nCurrent token reserves:');
  console.log('  virtualSol:', Number(token?.virtualSolReserves));
  console.log('  virtualTokens:', Number(token?.virtualTokenReserves));
  console.log('  currentPrice:', Number(token?.virtualSolReserves) / Number(token?.virtualTokenReserves));
  await prisma.$disconnect();
}
checkReserves();
