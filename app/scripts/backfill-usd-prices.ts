#!/usr/bin/env ts-node
/**
 * Backfill USD prices for historical trades and candles
 * 
 * This script:
 * 1. Fetches historical SOL/USD prices from CoinGecko
 * 2. Updates trades with sol_price_usd at trade time
 * 3. Updates candles with USD OHLCV values
 * 
 * Run after applying the Prisma migration:
 *   npx prisma db push
 *   npx ts-node scripts/backfill-usd-prices.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// CoinGecko API for historical SOL prices
const COINGECKO_API = 'https://api.coingecko.com/api/v3';

interface SolPriceCache {
  [date: string]: number; // YYYY-MM-DD -> price
}

const priceCache: SolPriceCache = {};

/**
 * Fetch SOL/USD price for a specific date from CoinGecko
 */
async function getSolPriceForDate(date: Date): Promise<number | null> {
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  
  // Check cache first
  if (priceCache[dateStr]) {
    return priceCache[dateStr];
  }
  
  try {
    // Format date for CoinGecko (DD-MM-YYYY)
    const [year, month, day] = dateStr.split('-');
    const cgDate = `${day}-${month}-${year}`;
    
    const response = await fetch(
      `${COINGECKO_API}/coins/solana/history?date=${cgDate}&localization=false`
    );
    
    if (!response.ok) {
      console.warn(`⚠️  Failed to fetch price for ${dateStr}: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    const price = data.market_data?.current_price?.usd;
    
    if (price) {
      priceCache[dateStr] = price;
      return price;
    }
    
    return null;
  } catch (error) {
    console.warn(`⚠️  Error fetching price for ${dateStr}:`, error);
    return null;
  }
}

/**
 * Backfill USD prices for trades
 */
async function backfillTrades(batchSize: number = 100): Promise<number> {
  console.log('📊 Backfilling trades...');
  
  // Get trades without sol_price_usd
  const trades = await prisma.trade.findMany({
    where: { solPriceUsd: null },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
  });
  
  if (trades.length === 0) {
    console.log('   ✓ No trades need backfilling');
    return 0;
  }
  
  console.log(`   Processing ${trades.length} trades...`);
  
  let updated = 0;
  
  for (const trade of trades) {
    const solPrice = await getSolPriceForDate(trade.createdAt);
    
    if (solPrice) {
      await prisma.trade.update({
        where: { id: trade.id },
        data: { solPriceUsd: solPrice },
      });
      updated++;
      
      // Rate limit logging
      if (updated % 10 === 0) {
        process.stdout.write(`.`);
      }
    } else {
      process.stdout.write(`x`);
    }
    
    // Respect CoinGecko rate limits (10-30 calls per minute for free tier)
    await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log(`\n   ✓ Updated ${updated}/${trades.length} trades`);
  return trades.length;
}

/**
 * Backfill USD prices for candles
 */
async function backfillCandles(batchSize: number = 100): Promise<number> {
  console.log('📈 Backfilling candles...');
  
  // Get candles without USD fields
  const candles = await prisma.priceCandle.findMany({
    where: { 
      OR: [
        { openUsd: null },
        { closeUsd: null },
      ]
    },
    orderBy: { bucketTime: 'asc' },
    take: batchSize,
  });
  
  if (candles.length === 0) {
    console.log('   ✓ No candles need backfilling');
    return 0;
  }
  
  console.log(`   Processing ${candles.length} candles...`);
  
  let updated = 0;
  
  for (const candle of candles) {
    const solPrice = await getSolPriceForDate(candle.bucketTime);
    
    if (solPrice) {
      await prisma.priceCandle.update({
        where: { id: candle.id },
        data: {
          solPriceUsd: solPrice,
          openUsd: candle.open.toNumber() * solPrice,
          highUsd: candle.high.toNumber() * solPrice,
          lowUsd: candle.low.toNumber() * solPrice,
          closeUsd: candle.close.toNumber() * solPrice,
          volumeUsd: candle.volume.toNumber() * solPrice,
        },
      });
      updated++;
      
      if (updated % 10 === 0) {
        process.stdout.write(`.`);
      }
    } else {
      process.stdout.write(`x`);
    }
    
    await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log(`\n   ✓ Updated ${updated}/${candles.length} candles`);
  return candles.length;
}

/**
 * Main backfill process
 */
async function main() {
  console.log('🚀 Starting USD Price Backfill');
  console.log('================================');
  console.log('');
  
  try {
    // Get counts
    const tradeCount = await prisma.trade.count({ where: { solPriceUsd: null } });
    const candleCount = await prisma.priceCandle.count({
      where: { 
        OR: [
          { openUsd: null },
          { closeUsd: null },
        ]
      }
    });
    
    console.log(`📋 Found ${tradeCount} trades and ${candleCount} candles to backfill`);
    console.log('');
    
    if (tradeCount === 0 && candleCount === 0) {
      console.log('✅ Nothing to backfill!');
      return;
    }
    
    // Estimate time (2 seconds per API call, free tier limit)
    const totalCalls = Math.min(tradeCount, 100) + Math.min(candleCount, 100);
    const estimatedMinutes = Math.ceil((totalCalls * 2) / 60);
    console.log(`⏱️  Estimated time: ~${estimatedMinutes} minutes (limited by CoinGecko API)`);
    console.log('   (Use a paid API key for faster processing)');
    console.log('');
    
    // Backfill in batches
    let tradesProcessed = 0;
    let candlesProcessed = 0;
    
    // Process trades
    while (tradesProcessed < tradeCount) {
      const processed = await backfillTrades(100);
      if (processed === 0) break;
      tradesProcessed += processed;
      console.log(`   Progress: ${tradesProcessed}/${tradeCount} trades`);
    }
    
    console.log('');
    
    // Process candles
    while (candlesProcessed < candleCount) {
      const processed = await backfillCandles(100);
      if (processed === 0) break;
      candlesProcessed += processed;
      console.log(`   Progress: ${candlesProcessed}/${candleCount} candles`);
    }
    
    console.log('');
    console.log('✅ Backfill complete!');
    console.log(`   Trades updated: ${tradesProcessed}`);
    console.log(`   Candles updated: ${candlesProcessed}`);
    
  } catch (error) {
    console.error('❌ Backfill failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { backfillTrades, backfillCandles, getSolPriceForDate };
