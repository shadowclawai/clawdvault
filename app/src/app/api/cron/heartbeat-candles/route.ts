import { NextResponse } from 'next/server';
import { db } from '@/lib/prisma';
import { getSolPrice } from '@/lib/sol-price';

export const dynamic = 'force-dynamic';

/**
 * Generate and update heartbeat candles for tokens with no recent trades
 * This ensures USD charts reflect current SOL price even without trading activity
 * 
 * For each token:
 * 1. Creates or updates the 1m candle based on current SOL price
 * 2. Propagates the 1m candle values up to higher timeframes (5m, 15m, 1h, 1d)
 * 
 * Higher timeframes update their high/low/close based on the 1m candle values
 */
export async function GET(request: Request) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get current SOL price
    const solPriceUsd = await getSolPrice();
    if (!solPriceUsd) {
      throw new Error('Failed to fetch SOL price');
    }

    const now = new Date();
    const results: { token: string; intervals: string[] }[] = [];

    // Find all active (non-graduated) tokens
    const tokens = await db().token.findMany({
      where: { graduated: false },
      select: { mint: true, name: true, symbol: true }
    });

    for (const token of tokens) {
      const tokenResults: string[] = [];

      // Get last trade for this token
      const lastTrade = await db().trade.findFirst({
        where: { tokenMint: token.mint },
        orderBy: { createdAt: 'desc' },
        select: {
          priceSol: true,
          solPriceUsd: true,
          createdAt: true
        }
      });

      if (!lastTrade) continue; // No trades yet, skip

      const lastTradePriceSol = Number(lastTrade.priceSol);
      const currentPriceUsd = lastTradePriceSol * solPriceUsd;

      // First, handle the 1m candle
      const oneMinBucket = getBucketTime(now, '1m');
      await getOrCreateCandle(
        token.mint, '1m', oneMinBucket,
        lastTradePriceSol, currentPriceUsd, solPriceUsd
      );
      
      // Update 1m candle with current values
      const updatedOneMin = await updateCandleFromPrice(
        token.mint, '1m', oneMinBucket,
        lastTradePriceSol, currentPriceUsd, solPriceUsd
      );
      if (updatedOneMin) tokenResults.push('1m');

      // Propagate to higher timeframes
      const higherTimeframes = [
        { name: '5m', bucket: getBucketTime(now, '5m') },
        { name: '15m', bucket: getBucketTime(now, '15m') },
        { name: '1h', bucket: getBucketTime(now, '1h') },
        { name: '1d', bucket: getBucketTime(now, '1d') },
      ];

      for (const tf of higherTimeframes) {
        // Check if this 1m candle belongs to the higher timeframe bucket
        if (isCandleInBucket(oneMinBucket, tf.bucket, tf.name)) {
          // Get or create the higher timeframe candle
          await getOrCreateCandle(
            token.mint, tf.name, tf.bucket,
            lastTradePriceSol, currentPriceUsd, solPriceUsd
          );
          
          // Update high/low/close from the 1m candle values
          const updated = await updateHigherTimeframe(
            token.mint, tf.name, tf.bucket,
            currentPriceUsd, lastTradePriceSol
          );
          if (updated) tokenResults.push(tf.name);
        }
      }

      if (tokenResults.length > 0) {
        results.push({
          token: `${token.symbol} (${token.mint.slice(0, 8)}...)`,
          intervals: tokenResults
        });
      }
    }

    return NextResponse.json({
      success: true,
      solPriceUsd,
      tokensUpdated: results.length,
      details: results
    });

  } catch (error) {
    console.error('Heartbeat candle generation failed:', error);
    return NextResponse.json(
      { error: 'Failed to generate heartbeat candles' },
      { status: 500 }
    );
  }
}

async function getOrCreateCandle(
  tokenMint: string,
  interval: string,
  bucketTime: Date,
  lastTradePriceSol: number,
  currentPriceUsd: number,
  solPriceUsd: number
): Promise<any> {
  // Check if candle exists
  let candle = await db().priceCandle.findUnique({
    where: {
      tokenMint_interval_bucketTime: { tokenMint, interval, bucketTime }
    }
  });

  if (candle) return candle;

  // Get previous candle for this interval to determine open
  const prevCandle = await db().priceCandle.findFirst({
    where: { tokenMint, interval },
    orderBy: { bucketTime: 'desc' },
    select: { closeUsd: true, close: true, solPriceUsd: true }
  });

  const prevPriceSol = prevCandle?.close ? Number(prevCandle.close) : lastTradePriceSol;
  const prevPriceUsd = prevCandle?.closeUsd ? Number(prevCandle.closeUsd) : currentPriceUsd;

  // Create new candle
  candle = await db().priceCandle.create({
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

  return candle;
}

async function updateCandleFromPrice(
  tokenMint: string,
  interval: string,
  bucketTime: Date,
  lastTradePriceSol: number,
  currentPriceUsd: number,
  solPriceUsd: number
): Promise<boolean> {
  const candle = await db().priceCandle.findUnique({
    where: { tokenMint_interval_bucketTime: { tokenMint, interval, bucketTime } }
  });

  if (!candle) return false;

  const newHighUsd = Math.max(Number(candle.highUsd), currentPriceUsd);
  const newLowUsd = Math.min(Number(candle.lowUsd), currentPriceUsd);

  // Only update if values changed
  if (newHighUsd !== Number(candle.highUsd) || 
      newLowUsd !== Number(candle.lowUsd) ||
      currentPriceUsd !== Number(candle.closeUsd)) {
    
    await db().priceCandle.update({
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

async function updateHigherTimeframe(
  tokenMint: string,
  interval: string,
  bucketTime: Date,
  oneMinPriceUsd: number,
  oneMinPriceSol: number
): Promise<boolean> {
  const candle = await db().priceCandle.findUnique({
    where: { tokenMint_interval_bucketTime: { tokenMint, interval, bucketTime } }
  });

  if (!candle) return false;

  const newHighUsd = Math.max(Number(candle.highUsd), oneMinPriceUsd);
  const newLowUsd = Math.min(Number(candle.lowUsd), oneMinPriceUsd);

  // Only update if high or low changed
  if (newHighUsd !== Number(candle.highUsd) || newLowUsd !== Number(candle.lowUsd)) {
    await db().priceCandle.update({
      where: { tokenMint_interval_bucketTime: { tokenMint, interval, bucketTime } },
      data: {
        high: oneMinPriceSol,
        low: oneMinPriceSol,
        close: oneMinPriceSol,
        highUsd: newHighUsd,
        lowUsd: newLowUsd,
        closeUsd: oneMinPriceUsd,
      }
    });
    return true;
  }
  
  // Still update close even if h/l didn't change
  if (oneMinPriceUsd !== Number(candle.closeUsd)) {
    await db().priceCandle.update({
      where: { tokenMint_interval_bucketTime: { tokenMint, interval, bucketTime } },
      data: {
        close: oneMinPriceSol,
        closeUsd: oneMinPriceUsd,
      }
    });
    return true;
  }
  
  return false;
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

function isCandleInBucket(
  oneMinBucket: Date,
  higherBucket: Date,
  higherInterval: string
): boolean {
  // Check if the 1m candle falls within the higher timeframe bucket
  const oneMinTime = oneMinBucket.getTime();
  const bucketStart = higherBucket.getTime();
  
  let bucketEnd: number;
  switch (higherInterval) {
    case '5m':
      bucketEnd = bucketStart + 5 * 60 * 1000;
      break;
    case '15m':
      bucketEnd = bucketStart + 15 * 60 * 1000;
      break;
    case '1h':
      bucketEnd = bucketStart + 60 * 60 * 1000;
      break;
    case '1d':
      bucketEnd = bucketStart + 24 * 60 * 60 * 1000;
      break;
    default:
      return false;
  }
  
  return oneMinTime >= bucketStart && oneMinTime < bucketEnd;
}