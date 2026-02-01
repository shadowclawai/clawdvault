import { NextResponse } from 'next/server';

// Cache the price server-side
let cachedPrice: number | null = null;
let lastFetch: number = 0;
const CACHE_DURATION = 60 * 1000; // 60 seconds
const STALE_DURATION = 5 * 60 * 1000; // Consider stale after 5 minutes

export const dynamic = 'force-dynamic';

export async function GET() {
  const now = Date.now();
  const age = now - lastFetch;
  
  // Return cached price if still valid
  if (age < CACHE_DURATION && cachedPrice !== null) {
    console.log(`[SOL Price] Returning cached: $${cachedPrice?.toFixed(2)} (age: ${Math.floor(age / 1000)}s)`);
    return NextResponse.json({ 
      price: cachedPrice, 
      valid: true,
      cached: true,
      age: Math.floor(age / 1000)
    });
  }

  // Fetch fresh price
  console.log('[SOL Price] Cache expired, fetching from Jupiter...');
  try {
    const res = await fetch('https://price.jup.ag/v6/price?ids=SOL', {
      next: { revalidate: 60 }
    });
    const data = await res.json();
    
    if (data.data?.SOL?.price) {
      cachedPrice = data.data.SOL.price;
      lastFetch = now;
      console.log(`[SOL Price] Fresh fetch: $${cachedPrice.toFixed(2)}`);
      return NextResponse.json({ 
        price: cachedPrice, 
        valid: true,
        cached: false,
        age: 0
      });
    }
    console.warn('[SOL Price] Jupiter response missing price data:', data);
  } catch (err) {
    console.error('[SOL Price] Fetch failed:', err);
  }

  // If we have a recent-ish cached price, use it but mark as potentially stale
  if (cachedPrice !== null && age < STALE_DURATION) {
    console.log(`[SOL Price] Using stale cache: $${cachedPrice?.toFixed(2)} (age: ${Math.floor(age / 1000)}s)`);
    return NextResponse.json({ 
      price: cachedPrice, 
      valid: true,
      cached: true,
      stale: true,
      age: Math.floor(age / 1000)
    });
  }

  // No valid price available
  console.warn('[SOL Price] No valid price available, returning null');
  return NextResponse.json({ 
    price: null, 
    valid: false,
    cached: false,
    age: 0
  });
}
