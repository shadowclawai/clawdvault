import { NextResponse } from 'next/server';
import { db } from '@/lib/prisma';
import { getSolPrice } from '@/lib/sol-price';

export const dynamic = 'force-dynamic';

// Generate heartbeat candles for tokens with no recent trades
// This ensures USD charts reflect current SOL price even without trading activity
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

      // Define intervals to check
      const intervals = [
        { name: '1m', durationMs: 60 * 1000 },
        { name: '5m', durationMs: 5 * 60 * 1000 },
        { name: '15m', durationMs: 15 * 60 * 1000 },
        { name: '1h', durationMs: 60 * 60 * 1000 },
        { name: '1d', durationMs: 24 * 60 * 60 * 1000 },
      ];

      for (const interval of intervals) {
        // Check if we need a new candle for this interval
        const bucketTime = getBucketTime(now, interval.name);

        // Check if candle already exists for this bucket
        const existingCandle = await db().priceCandle.findUnique({
          where: {
            tokenMint_interval_bucketTime: {
              tokenMint: token.mint,
              interval: interval.name,
              bucketTime
            }
          }
        });

        if (!existingCandle) {
          // Get previous candle for this interval to determine open
          const prevCandle = await db().priceCandle.findFirst({
            where: {
              tokenMint: token.mint,
              interval: interval.name,
            },
            orderBy: { bucketTime: 'desc' },
            select: { closeUsd: true, close: true, solPriceUsd: true }
          });

          // Calculate SOL-equivalent price
          // We store both SOL and USD values
          const prevPriceSol = prevCandle?.close ? Number(prevCandle.close) : lastTradePriceSol;
          const prevPriceUsd = prevCandle?.closeUsd ? Number(prevCandle.closeUsd) : currentPriceUsd;
          const prevSolPrice = prevCandle?.solPriceUsd ? Number(prevCandle.solPriceUsd) : solPriceUsd;

          // Calculate wicks based on SOL price movement during the interval
          // If SOL price changed, the USD price would have moved even without trades
          const solPriceChange = solPriceUsd / prevSolPrice;

          // For USD price: high/low reflect the movement from prev price to current price
          // High is when SOL was at its max (token USD price would be highest)
          // Low is when SOL was at its min (token USD price would be lowest)
          const highUsd = Math.max(prevPriceUsd, currentPriceUsd, prevPriceUsd * solPriceChange);
          const lowUsd = Math.min(prevPriceUsd, currentPriceUsd, prevPriceUsd / solPriceChange);

          // Create heartbeat candle with proper USD wicks reflecting SOL price movement
          await db().priceCandle.create({
            data: {
              tokenMint: token.mint,
              interval: interval.name,
              bucketTime,
              open: prevPriceSol,
              high: prevPriceSol,
              low: prevPriceSol,
              close: lastTradePriceSol,
              volume: 0, // No volume since no trades
              openUsd: prevPriceUsd,
              highUsd,
              lowUsd,
              closeUsd: currentPriceUsd,
              volumeUsd: 0,
              solPriceUsd,
              trades: 0,
            }
          });

          tokenResults.push(interval.name);
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