/**
 * Cron: Update SOL Price and Candles
 * Runs every minute to:
 * 1. Fetch and store current SOL/USD price
 * 2. Create/update heartbeat candles for all tokens
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
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', {
      signal: AbortSignal.timeout(5000)
    });
    
    if (!res.ok) return null;
    
    const data = await res.json();
    const price = data.solana?.usd;
    
    if (typeof price === 'number' && price > 0) return price;
    return null;
  }, 'CoinGecko');
}

async function fetchFromBinance(): Promise<number | null> {
  return fetchWithFallback(async () => {
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT', {
      signal: AbortSignal.timeout(5000)
    });
    
    if (!res.ok) return null;
    
    const data = await res.json();
    const price = parseFloat(data.price);
    
    if (!isNaN(price) && price > 0) return price;
    return null;
  }, 'Binance');
}

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('💰 [CRON] Starting SOL price + candles update...');
  
  const startTime = Date.now();
  
  // Step 1: Fetch SOL price
  const results: PriceSource[] = [];
  
  const [coinGeckoPrice, binancePrice] = await Promise.all([
    fetchFromCoinGecko(),
    fetchFromBinance(),
  ]);
  
  if (coinGeckoPrice) results.push({ name: 'coingecko', price: coinGeckoPrice });
  if (binancePrice) results.push({ name: 'binance', price: binancePrice });
  
  if (results.length === 0) {
    console.error('❌ [CRON] All price sources failed');
    return NextResponse.json(
      { success: false, error: 'All price sources failed' },
      { status: 500 }
    );
  }
  
  // Calculate median price
  const prices = results.map(r => r.price).sort((a, b) => a - b);
  const solPriceUsd = prices.length % 2 === 0
    ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
    : prices[Math.floor(prices.length / 2)];
  
  const primarySource = results[0].name;
  
  // Step 2: Update SOL price in database
  await db().solPrice.upsert({
    where: { id: 'current' },
    create: { id: 'current', price: solPriceUsd, source: primarySource },
    update: { price: solPriceUsd, source: primarySource },
  });
  
  // Step 3: Create/update heartbeat candles for all tokens
  const candlesUpdated = await updateHeartbeatCandles(solPriceUsd);
  
  const duration = Date.now() - startTime;
  
  console.log(`✅ [CRON] SOL: $${solPriceUsd.toFixed(2)}, Candles: ${candlesUpdated}, Time: ${duration}ms`);
  
  return NextResponse.json({
    success: true,
    solPrice: solPriceUsd,
    source: primarySource,
    candlesUpdated,
    duration: `${duration}ms`,
  });
}

/**
 * Create/update heartbeat candles for all active tokens
 * For each token:
 * - Create/update 1m candle
 * - Propagate to higher timeframes (5m, 15m, 1h, 1d)
 */
async function updateHeartbeatCandles(solPriceUsd: number): Promise<number> {
  const prisma = db();
  let totalUpdates = 0;
  
  // Find all active tokens
  const tokens = await prisma.token.findMany({
    where: { graduated: false },
    select: { mint: true }
  });
  
  const now = new Date();
  
  for (const token of tokens) {
    // Get last trade price for this token
    const lastTrade = await prisma.trade.findFirst({
      where: { tokenMint: token.mint },
      orderBy: { createdAt: 'desc' },
      select: { priceSol: true }
    });
    
    if (!lastTrade) continue; // No trades yet
    
    const lastTradePriceSol = Number(lastTrade.priceSol);
    const currentPriceUsd = lastTradePriceSol * solPriceUsd;
    
    // Process 1m candle
    const oneMinBucket = getBucketTime(now, '1m');
    const oneMinUpdated = await createOrUpdateCandle(
      token.mint, '1m', oneMinBucket,
      lastTradePriceSol, currentPriceUsd, solPriceUsd
    );
    if (oneMinUpdated) totalUpdates++;
    
    // Propagate to higher timeframes
    const higherTimeframes = [
      { name: '5m', bucket: getBucketTime(now, '5m') },
      { name: '15m', bucket: getBucketTime(now, '15m') },
      { name: '1h', bucket: getBucketTime(now, '1h') },
      { name: '1d', bucket: getBucketTime(now, '1d') },
    ];
    
    for (const tf of higherTimeframes) {
      if (isCandleInBucket(oneMinBucket, tf.bucket, tf.name)) {
        const updated = await createOrUpdateCandle(
          token.mint, tf.name, tf.bucket,
          lastTradePriceSol, currentPriceUsd, solPriceUsd
        );
        if (updated) totalUpdates++;
      }
    }
  }
  
  return totalUpdates;
}

async function createOrUpdateCandle(
  tokenMint: string,
  interval: string,
  bucketTime: Date,
  lastTradePriceSol: number,
  currentPriceUsd: number,
  solPriceUsd: number
): Promise<boolean> {
  const prisma = db();
  
  // Check if candle exists
  const existing = await prisma.priceCandle.findUnique({
    where: {
      tokenMint_interval_bucketTime: { tokenMint, interval, bucketTime }
    }
  });
  
  if (!existing) {
    // Get previous candle for open price
    const prevCandle = await prisma.priceCandle.findFirst({
      where: { tokenMint, interval },
      orderBy: { bucketTime: 'desc' },
      select: { closeUsd: true, close: true }
    });
    
    const prevPriceSol = prevCandle?.close ? Number(prevCandle.close) : lastTradePriceSol;
    const prevPriceUsd = prevCandle?.closeUsd ? Number(prevCandle.closeUsd) : currentPriceUsd;
    
    // Create new candle
    await prisma.priceCandle.create({
      data: {
        tokenMint,
        interval,
        bucketTime,
        open: prevPriceSol,
        high: lastTradePriceSol,
        low: lastTradePriceSol,
        close: lastTradePriceSol,
        volume: 0,
        openUsd: prevPriceUsd,
        highUsd: currentPriceUsd,
        lowUsd: currentPriceUsd,
        closeUsd: currentPriceUsd,
        volumeUsd: 0,
        solPriceUsd,
        trades: 0,
      }
    });
    return true;
  }
  
  // Update existing candle
  const newHighUsd = Math.max(Number(existing.highUsd), currentPriceUsd);
  const newLowUsd = Math.min(Number(existing.lowUsd), currentPriceUsd);
  
  if (newHighUsd !== Number(existing.highUsd) || 
      newLowUsd !== Number(existing.lowUsd) ||
      currentPriceUsd !== Number(existing.closeUsd)) {
    
    await prisma.priceCandle.update({
      where: { tokenMint_interval_bucketTime: { tokenMint, interval, bucketTime } },
      data: {
        high: lastTradePriceSol,
        low: lastTradePriceSol,
        close: lastTradePriceSol,
        highUsd: newHighUsd,
        lowUsd: newLowUsd,
        closeUsd: currentPriceUsd,
        solPriceUsd,
      }
    });
    return true;
  }
  
  return false;
}

function getBucketTime(date: Date, interval: string): Date {
  const d = new Date(date);
  
  switch (interval) {
    case '1m': d.setSeconds(0, 0); break;
    case '5m': d.setMinutes(Math.floor(d.getMinutes() / 5) * 5, 0, 0); break;
    case '15m': d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0); break;
    case '1h': d.setMinutes(0, 0, 0); break;
    case '1d': d.setHours(0, 0, 0, 0); break;
  }
  
  return d;
}

function isCandleInBucket(
  oneMinBucket: Date,
  higherBucket: Date,
  higherInterval: string
): boolean {
  const oneMinTime = oneMinBucket.getTime();
  const bucketStart = higherBucket.getTime();
  
  const durations: Record<string, number> = {
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
  };
  
  const bucketEnd = bucketStart + (durations[higherInterval] || 0);
  return oneMinTime >= bucketStart && oneMinTime < bucketEnd;
}