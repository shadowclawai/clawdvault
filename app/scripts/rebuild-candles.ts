/**
 * Rebuild candles from all trades
 */
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

const prisma = new PrismaClient();

type CandleInterval = '1m' | '5m' | '15m' | '1h' | '1d';

const INTERVAL_MS: Record<CandleInterval, number> = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

function getBucketTime(timestamp: Date, interval: CandleInterval): Date {
  const ms = INTERVAL_MS[interval];
  const bucketMs = Math.floor(timestamp.getTime() / ms) * ms;
  return new Date(bucketMs);
}

async function updateCandles(
  tokenMint: string,
  price: number | Decimal,
  solVolume: number | Decimal,
  timestamp: Date,
  solPriceUsd?: number | Decimal | null
): Promise<void> {
  const priceDecimal = new Decimal(price.toString());
  const volumeDecimal = new Decimal(solVolume.toString());
  const hasUsdData = solPriceUsd != null && Number(solPriceUsd) > 0;
  const solPriceNum = hasUsdData ? Number(solPriceUsd) : 0;

  const intervals: CandleInterval[] = ['1m', '5m', '15m', '1h', '1d'];

  await Promise.all(intervals.map(async (interval) => {
    const bucketTime = getBucketTime(timestamp, interval);

    const existing = await prisma.priceCandle.findUnique({
      where: {
        tokenMint_interval_bucketTime: {
          tokenMint,
          interval,
          bucketTime,
        },
      },
    });

    if (existing) {
      // Build update data
      let updateData: any = {
        high: priceDecimal.greaterThan(existing.high) ? priceDecimal : existing.high,
        low: priceDecimal.lessThan(existing.low) ? priceDecimal : existing.low,
        close: priceDecimal,
        volume: existing.volume.add(volumeDecimal),
        trades: { increment: 1 },
      };

      // Update USD fields if we have SOL price data
      if (hasUsdData) {
        const priceUsd = priceDecimal.mul(solPriceNum);
        const volumeUsd = volumeDecimal.mul(solPriceNum);
        const existingHighUsd = existing.highUsd ? new Decimal(existing.highUsd.toString()) : priceUsd;
        const existingLowUsd = existing.lowUsd ? new Decimal(existing.lowUsd.toString()) : priceUsd;
        const existingVolumeUsd = existing.volumeUsd ? new Decimal(existing.volumeUsd.toString()) : new Decimal(0);

        updateData = {
          ...updateData,
          solPriceUsd: solPriceNum,
          highUsd: priceUsd.greaterThan(existingHighUsd) ? priceUsd.toNumber() : existingHighUsd.toNumber(),
          lowUsd: priceUsd.lessThan(existingLowUsd) ? priceUsd.toNumber() : existingLowUsd.toNumber(),
          closeUsd: priceUsd.toNumber(),
          volumeUsd: existingVolumeUsd.add(volumeUsd).toNumber(),
        };

        // Set openUsd if not already set
        if (!existing.openUsd) {
          updateData.openUsd = priceUsd.toNumber();
        }
      }

      await prisma.priceCandle.update({
        where: {
          tokenMint_interval_bucketTime: {
            tokenMint,
            interval,
            bucketTime,
          },
        },
        data: updateData,
      });
    } else {
      // Create new candle
      let createData: any = {
        tokenMint,
        interval,
        bucketTime,
        open: priceDecimal,
        high: priceDecimal,
        low: priceDecimal,
        close: priceDecimal,
        volume: volumeDecimal,
        trades: 1,
      };

      // Add USD fields if we have SOL price data
      if (hasUsdData) {
        const priceUsd = priceDecimal.mul(solPriceNum);
        const volumeUsd = volumeDecimal.mul(solPriceNum);

        createData = {
          ...createData,
          solPriceUsd: solPriceNum,
          openUsd: priceUsd.toNumber(),
          highUsd: priceUsd.toNumber(),
          lowUsd: priceUsd.toNumber(),
          closeUsd: priceUsd.toNumber(),
          volumeUsd: volumeUsd.toNumber(),
        };
      }

      await prisma.priceCandle.create({
        data: createData,
      });
    }
  }));
}

async function main() {
  // Clear existing candles
  console.log('Clearing existing candles...');
  await prisma.priceCandle.deleteMany({});

  // Get all trades ordered by time
  const trades = await prisma.trade.findMany({
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Rebuilding candles for ${trades.length} trades...\n`);

  for (const trade of trades) {
    const hasUsd = trade.solPriceUsd != null;
    console.log(`  ${trade.tokenMint.slice(0,8)}... ${Number(trade.solAmount).toFixed(2)} SOL @ ${trade.createdAt.toISOString().slice(0,16)}${hasUsd ? ' (USD data)' : ''}`);
    await updateCandles(
      trade.tokenMint,
      trade.priceSol,
      trade.solAmount,
      trade.createdAt,
      trade.solPriceUsd
    );
  }

  // Count candles
  const count = await prisma.priceCandle.count();
  console.log(`\n✅ Created ${count} candles!`);

  await prisma.$disconnect();
}

main().catch(console.error);
