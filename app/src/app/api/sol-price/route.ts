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

  // Fetch fresh price - try multiple sources
  console.log('[SOL Price] Cache expired, fetching fresh price...');
  
  // Try CoinGecko first (more reliable)
  try {
    console.log('[SOL Price] Trying CoinGecko...');
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', {
      signal: AbortSignal.timeout(5000)
    });
    const data = await res.json();
    
    if (data.solana?.usd) {
      cachedPrice = data.solana.usd;
      lastFetch = now;
      console.log(`[SOL Price] CoinGecko success: $${cachedPrice.toFixed(2)}`);
      return NextResponse.json({ 
        price: cachedPrice, 
        valid: true,
        cached: false,
        source: 'coingecko',
        age: 0
      });
    }
    console.warn('[SOL Price] CoinGecko response missing price');
  } catch (err) {
    console.warn('[SOL Price] CoinGecko failed:', (err as Error).message);
  }

  // Try Jupiter as fallback
  try {
    console.log('[SOL Price] Trying Jupiter...');
    const res = await fetch('https://price.jup.ag/v6/price?ids=SOL', {
      signal: AbortSignal.timeout(5000)
    });
    const data = await res.json();
    
    if (data.data?.SOL?.price) {
      cachedPrice = data.data.SOL.price;
      lastFetch = now;
      console.log(`[SOL Price] Jupiter success: $${cachedPrice.toFixed(2)}`);
      return NextResponse.json({ 
        price: cachedPrice, 
        valid: true,
        cached: false,
        source: 'jupiter',
        age: 0
      });
    }
    console.warn('[SOL Price] Jupiter response missing price');
  } catch (err) {
    console.warn('[SOL Price] Jupiter failed:', (err as Error).message);
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
