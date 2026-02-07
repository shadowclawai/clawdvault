/**
 * Cron: Update SOL Price
 * Runs every minute to fetch and store current SOL price
 * 
 * Vercel Cron calls this with CRON_SECRET header
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

interface PriceSource {
  name: 'coingecko' | 'binance';
  price: number;
}

/**
 * Wrapper to ensure fetch never throws - returns null on any error
 */
async function fetchWithFallback<T>(
  fetchFn: () => Promise<T | null>,
  sourceName: string
): Promise<T | null> {
  try {
    return await fetchFn();
  } catch (err) {
    console.warn(`[SOL Price Cron] ${sourceName} failed:`, (err as Error).message);
    return null;
  }
}

async function fetchFromCoinGecko(): Promise<number | null> {
  return fetchWithFallback(async () => {
    console.log('[CRON] Fetching CoinGecko...');
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', {
      signal: AbortSignal.timeout(5000)
    });
    console.log(`[CRON] CoinGecko status: ${res.status}`);
    
    if (!res.ok) {
      console.warn(`[SOL Price Cron] CoinGecko returned ${res.status}`);
      return null;
    }
    
    const data = await res.json();
    const price = data.solana?.usd;
    
    if (typeof price === 'number' && price > 0) {
      console.log(`[SOL Price Cron] CoinGecko: $${price.toFixed(2)}`);
      return price;
    }
    return null;
  }, 'CoinGecko');
}

async function fetchFromBinance(): Promise<number | null> {
  return fetchWithFallback(async () => {
    console.log('[CRON] Fetching Binance...');
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT', {
      signal: AbortSignal.timeout(5000)
    });
    console.log(`[CRON] Binance status: ${res.status}`);
    
    if (!res.ok) {
      console.warn(`[SOL Price Cron] Binance returned ${res.status}`);
      return null;
    }
    
    const data = await res.json();
    const price = parseFloat(data.price);
    
    if (!isNaN(price) && price > 0) {
      console.log(`[SOL Price Cron] Binance: $${price.toFixed(2)}`);
      return price;
    }
    return null;
  }, 'Binance');
}

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.warn('⚠️ Unauthorized cron attempt');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('💰 [CRON] Starting SOL price update...');
  
  const startTime = Date.now();
  const results: PriceSource[] = [];
  
  try {
    // Fetch from multiple sources in parallel with overall timeout
    console.log('[CRON] Fetching from CoinGecko and Binance...');
    const [coinGeckoPrice, binancePrice] = await Promise.all([
      fetchFromCoinGecko(),
      fetchFromBinance(),
    ]);
    console.log(`[CRON] Results: CG=${coinGeckoPrice}, BN=${binancePrice}`);
    
    // Collect successful results
    if (coinGeckoPrice) results.push({ name: 'coingecko', price: coinGeckoPrice });
    if (binancePrice) results.push({ name: 'binance', price: binancePrice });
    
    if (results.length === 0) {
      console.error('❌ [CRON] All price sources failed');
      return NextResponse.json(
        { success: false, error: 'All price sources failed' },
        { status: 500 }
      );
    }
    
    // Calculate median price from all sources
    const prices = results.map(r => r.price).sort((a, b) => a - b);
    const medianPrice = prices.length % 2 === 0
      ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
      : prices[Math.floor(prices.length / 2)];
    
    // Use the first successful source as the primary source
    const primarySource = results[0].name;
    
    // Update database - upsert to single row with id='current'
    await db().solPrice.upsert({
      where: { id: 'current' },
      create: {
        id: 'current',
        price: medianPrice,
        source: primarySource,
      },
      update: {
        price: medianPrice,
        source: primarySource,
      },
    });
    
    const duration = Date.now() - startTime;
    
    console.log(`✅ [CRON] SOL price updated: $${medianPrice.toFixed(2)} (${primarySource}) in ${duration}ms`);
    
    // After updating SOL price, update candle close prices for active tokens
    const updatedTokens = await updateCandleClosePrices(medianPrice);
    
    return NextResponse.json({
      success: true,
      price: medianPrice,
      source: primarySource,
      sources: results.map(r => ({ name: r.name, price: r.price })),
      duration: `${duration}ms`,
      tokensUpdated: updatedTokens,
    });
    
  } catch (error) {
    console.error('❌ [CRON] SOL price update failed:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * Update candle close prices for all active tokens based on current SOL price
 * Formula: current_close_usd = last_trade_price_sol * current_sol_price_usd
 */
async function updateCandleClosePrices(solPriceUsd: number): Promise<number> {
  const prisma = db();
  
  // Find all active (non-graduated) tokens with recent trades
  const tokens = await prisma.token.findMany({
    where: { graduated: false },
    select: { mint: true }
  });
  
  let updatedCount = 0;
  const now = new Date();
  const intervals = ['1m', '5m', '15m', '1h', '1d'] as const;
  
  for (const token of tokens) {
    // Get last trade price for this token
    const lastTrade = await prisma.trade.findFirst({
      where: { tokenMint: token.mint },
      orderBy: { createdAt: 'desc' },
      select: { priceSol: true }
    });
    
    if (!lastTrade) continue; // No trades yet, skip
    
    const lastTradePriceSol = Number(lastTrade.priceSol);
    const currentPriceUsd = lastTradePriceSol * solPriceUsd;
    
    // Update current candles for each interval
    for (const interval of intervals) {
      const bucketTime = getBucketTime(now, interval);
      
      // Try to find and update the current candle
      const existingCandle = await prisma.priceCandle.findUnique({
        where: {
          tokenMint_interval_bucketTime: {
            tokenMint: token.mint,
            interval,
            bucketTime,
          },
        },
      });
      
      if (existingCandle) {
        // Update closeUsd based on current SOL price
        await prisma.priceCandle.update({
          where: {
            tokenMint_interval_bucketTime: {
              tokenMint: token.mint,
              interval,
              bucketTime,
            },
          },
          data: {
            closeUsd: currentPriceUsd,
            solPriceUsd: solPriceUsd,
            // Update high/low if current price exceeds them
            highUsd: Math.max(Number(existingCandle.highUsd || 0), currentPriceUsd),
            lowUsd: existingCandle.lowUsd 
              ? Math.min(Number(existingCandle.lowUsd), currentPriceUsd)
              : currentPriceUsd,
          },
        });
        updatedCount++;
      }
    }
  }
  
  console.log(`🕯️ [CRON] Updated ${updatedCount} candles across ${tokens.length} tokens`);
  return updatedCount;
}

function getBucketTime(date: Date, interval: string): Date {
  const d = new Date(date);
  
  switch (interval) {
    case '1m':
      d.setSeconds(0, 0);
      break;
    case '5m':
      d.setMinutes(Math.floor(d.getMinutes() / 5) * 5, 0, 0);
      break;
    case '15m':
      d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0);
      break;
    case '1h':
      d.setMinutes(0, 0, 0);
      break;
    case '1d':
      d.setHours(0, 0, 0, 0);
      break;
  }
  
  return d;
}