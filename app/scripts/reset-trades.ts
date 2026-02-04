/**
 * Reset all trades and candles to let them re-sync with correct prices
 */

import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();

  console.log('🔄 Resetting all trades and candles...\n');

  // Delete all candles
  const deletedCandles = await prisma.priceCandle.deleteMany({});
  console.log(`Deleted ${deletedCandles.count} candles`);

  // Delete all trades  
  const deletedTrades = await prisma.trade.deleteMany({});
  console.log(`Deleted ${deletedTrades.count} trades`);

  // Reset token reserves to initial values so sync recalculates correctly
  // Actually no - we want to keep current reserves from on-chain
  // The sync will just re-import trades without modifying reserves
  
  console.log('\n✅ Done! Run sync-trades cron to re-import trades with correct prices.');
  console.log('   Trades will be re-fetched from on-chain with accurate reserves.');
  
  await prisma.$disconnect();
}

main().catch(console.error);
