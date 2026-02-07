// SOL price utilities for trade and candle USD calculations
// Uses database-stored price with API fallback

import { db } from './prisma';

// In-memory cache for quick access
interface SolPriceCache {
  price: number;
  timestamp: number;
  source: string;
}

let solPriceCache: SolPriceCache | null = null;
const CACHE_DURATION_MS = 30 * 1000; // 30 second cache

/**
 * Get current SOL/USD price from database (with caching)
 * Falls back to API if database price is stale or unavailable
 */
export async function getSolPrice(): Promise<number | null> {
  const now = Date.now();
  
  // Check memory cache first
  if (solPriceCache && (now - solPriceCache.timestamp) < CACHE_DURATION_MS) {
    return solPriceCache.price;
  }
  
  try {
    // Try database first
    const dbPrice = await db().solPrice.findUnique({
      where: { id: 'current' }
    });
    
    if (dbPrice) {
      const price = Number(dbPrice.price);
      const updatedAt = new Date(dbPrice.updatedAt).getTime();
      const age = now - updatedAt;
      
      // Use database price if it's less than 2 minutes old
      if (age < 2 * 60 * 1000 && price > 0) {
        solPriceCache = { price, timestamp: now, source: dbPrice.source };
        return price;
      }
      
      // Database price is stale, try to update it
      console.warn(`[getSolPrice] Database price is ${Math.floor(age / 1000)}s old, fetching fresh...`);
    }
  } catch (error) {
    console.warn('[getSolPrice] Database fetch failed:', error);
  }
  
  // Fallback to API
  return await fetchSolPriceFromApi();
}

/**
 * Get SOL price and metadata (source, timestamp)
 */
export async function getSolPriceWithMeta(): Promise<{ price: number; source: string; updatedAt: Date } | null> {
  try {
    const dbPrice = await db().solPrice.findUnique({
      where: { id: 'current' }
    });
    
    if (dbPrice && Number(dbPrice.price) > 0) {
      return {
        price: Number(dbPrice.price),
        source: dbPrice.source,
        updatedAt: dbPrice.updatedAt,
      };
    }
  } catch (error) {
    console.warn('[getSolPriceWithMeta] Database fetch failed:', error);
  }
  
  // Fallback to API
  const price = await fetchSolPriceFromApi();
  if (price) {
    return {
      price,
      source: 'api-fallback',
      updatedAt: new Date(),
    };
  }
  
  return null;
}

/**
 * Fetch SOL price directly from APIs
 * Uses CoinGecko first, then Binance
 * Returns null on any failure rather than throwing
 */
async function fetchSolPriceFromApi(): Promise<number | null> {
  const now = Date.now();
  
  // Try CoinGecko first
  const coinGeckoPrice = await fetchWithFallback(async () => {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      { signal: AbortSignal.timeout(5000) }
    );
    
    if (!response.ok) return null;
    
    const data = await response.json();
    const price = data.solana?.usd;
    
    if (typeof price === 'number' && price > 0) {
      solPriceCache = { price, timestamp: now, source: 'coingecko' };
      return price;
    }
    return null;
  }, 'CoinGecko');
  
  if (coinGeckoPrice !== null) return coinGeckoPrice;
  
  // Fallback to Binance
  const binancePrice = await fetchWithFallback(async () => {
    const response = await fetch(
      'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT',
      { signal: AbortSignal.timeout(5000) }
    );
    
    if (!response.ok) return null;
    
    const data = await response.json();
    const price = parseFloat(data.price);
    
    if (!isNaN(price) && price > 0) {
      solPriceCache = { price, timestamp: now, source: 'binance' };
      return price;
    }
    return null;
  }, 'Binance');
  
  if (binancePrice !== null) return binancePrice;
  
  // Return stale cache if available
  if (solPriceCache) {
    console.warn('[getSolPrice] Returning stale cached price');
    return solPriceCache.price;
  }
  
  return null;
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
  } catch (error) {
    console.warn(`[getSolPrice] ${sourceName} failed:`, error);
    return null;
  }
}

/**
 * Update SOL price in database (used by cron job)
 */
export async function updateSolPriceInDb(price: number, source: string): Promise<void> {
  await db().solPrice.upsert({
    where: { id: 'current' },
    create: {
      id: 'current',
      price,
      source,
    },
    update: {
      price,
      source,
    },
  });
  
  // Update cache
  solPriceCache = { price, timestamp: Date.now(), source };
}

/**
 * Clear the SOL price cache (useful for testing)
 */
export function clearSolPriceCache(): void {
  solPriceCache = null;
}
