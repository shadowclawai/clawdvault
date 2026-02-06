// SOL price utilities for trade and candle USD calculations

// Cache for SOL price (shared across functions)
interface SolPriceCache {
  price: number;
  timestamp: number;
}

let solPriceCache: SolPriceCache | null = null;
const CACHE_DURATION_MS = 60 * 1000; // 1 minute cache

/**
 * Fetch current SOL/USD price
 * Uses CoinGecko with Jupiter fallback
 */
export async function getSolPrice(): Promise<number | null> {
  const now = Date.now();
  
  // Check cache first
  if (solPriceCache && (now - solPriceCache.timestamp) < CACHE_DURATION_MS) {
    return solPriceCache.price;
  }
  
  try {
    // Try CoinGecko first
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      { signal: AbortSignal.timeout(5000) }
    );
    
    if (response.ok) {
      const data = await response.json();
      const price = data.solana?.usd;
      
      if (price) {
        solPriceCache = { price, timestamp: now };
        return price;
      }
    }
  } catch (error) {
    console.warn('[getSolPrice] CoinGecko failed:', error);
  }
  
  // Fallback to Jupiter
  try {
    const response = await fetch(
      'https://price.jup.ag/v6/price?ids=SOL',
      { signal: AbortSignal.timeout(5000) }
    );
    
    if (response.ok) {
      const data = await response.json();
      const price = data.data?.SOL?.price;
      
      if (price) {
        solPriceCache = { price, timestamp: now };
        return price;
      }
    }
  } catch (error) {
    console.warn('[getSolPrice] Jupiter failed:', error);
  }
  
  // Return stale cache if available
  if (solPriceCache) {
    console.warn('[getSolPrice] Returning stale cached price');
    return solPriceCache.price;
  }
  
  return null;
}

/**
 * Clear the SOL price cache (useful for testing)
 */
export function clearSolPriceCache(): void {
  solPriceCache = null;
}
