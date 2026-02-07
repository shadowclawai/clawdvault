import { NextResponse } from 'next/server';
import { getSolPriceWithMeta } from '@/lib/sol-price';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sol-price
 * Returns current SOL/USD price from database
 * Includes caching headers for client-side optimization
 */
export async function GET() {
  try {
    const priceData = await getSolPriceWithMeta();
    
    if (!priceData) {
      return NextResponse.json(
        { error: 'Price unavailable' },
        { status: 503 }
      );
    }
    
    // Calculate age of price data
    const now = Date.now();
    const updatedAt = priceData.updatedAt.getTime();
    const ageSeconds = Math.floor((now - updatedAt) / 1000);
    
    return NextResponse.json(
      {
        price: priceData.price,
        source: priceData.source,
        updatedAt: priceData.updatedAt.toISOString(),
        age: ageSeconds,
        valid: ageSeconds < 120, // Valid if less than 2 minutes old
      },
      {
        headers: {
          // Cache for 30 seconds on client, revalidate in background
          'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
        },
      }
    );
  } catch (error) {
    console.error('Failed to fetch SOL price:', error);
    return NextResponse.json(
      { error: 'Failed to fetch price' },
      { status: 500 }
    );
  }
}
