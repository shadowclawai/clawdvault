/**
 * Moltx.io Notification Client
 * Spammy pump.fun-style announcements for ClawdVault events
 */

const MOLTX_API_KEY = process.env.MOLTX_API_KEY;
const MOLTX_BASE_URL = 'https://moltx.io/v1';
const CLAWDVAULT_URL = 'https://clawdvault.com';

// Cached SOL price
let cachedSolPrice: { price: number; timestamp: number } | null = null;
const SOL_PRICE_CACHE_MS = 60_000; // 1 minute

async function getSolPrice(): Promise<number> {
  // Return cached if fresh
  if (cachedSolPrice && Date.now() - cachedSolPrice.timestamp < SOL_PRICE_CACHE_MS) {
    return cachedSolPrice.price;
  }
  
  try {
    const res = await fetch(`${CLAWDVAULT_URL}/api/sol-price`);
    const data = await res.json();
    if (data.price) {
      cachedSolPrice = { price: data.price, timestamp: Date.now() };
      return data.price;
    }
  } catch (err) {
    console.error('[Moltx] Failed to fetch SOL price:', err);
  }
  
  return cachedSolPrice?.price || 0;
}

// Format USD amount
function formatUsd(amount: number): string {
  if (amount >= 1000000) return '$' + (amount / 1000000).toFixed(2) + 'M';
  if (amount >= 1000) return '$' + (amount / 1000).toFixed(1) + 'K';
  if (amount >= 1) return '$' + amount.toFixed(2);
  return '$' + amount.toFixed(4);
}

interface MoltxPostResponse {
  success: boolean;
  data?: {
    post: {
      id: string;
      content: string;
    };
  };
  error?: string;
}

// Format SOL amount with nice decimals (handles very small prices)
function formatSol(amount: number): string {
  if (amount >= 1) return amount.toFixed(2);
  if (amount >= 0.1) return amount.toFixed(3);
  if (amount >= 0.0001) return amount.toFixed(4);
  if (amount >= 0.0000001) return amount.toFixed(8);
  // For extremely small numbers, use scientific notation
  return amount.toExponential(2);
}

// Format token amount (abbreviate large numbers)
function formatTokens(amount: number): string {
  if (amount >= 1_000_000_000) return (amount / 1_000_000_000).toFixed(2) + 'B';
  if (amount >= 1_000_000) return (amount / 1_000_000).toFixed(2) + 'M';
  if (amount >= 1_000) return (amount / 1_000).toFixed(2) + 'K';
  return amount.toFixed(2);
}

// Shorten wallet address
function shortenAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

/**
 * Post to Moltx
 */
async function postToMoltx(content: string): Promise<MoltxPostResponse | null> {
  if (!MOLTX_API_KEY) {
    console.warn('[Moltx] No API key configured, skipping notification');
    return null;
  }

  try {
    const response = await fetch(`${MOLTX_BASE_URL}/posts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MOLTX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error('[Moltx] Post failed:', data);
      return { success: false, error: data.error || 'Unknown error' };
    }

    console.log('[Moltx] Posted:', content.slice(0, 50) + '...');
    return data;
  } catch (error) {
    console.error('[Moltx] Post error:', error);
    return null;
  }
}

/**
 * Announce new token creation
 */
export async function announceNewToken(params: {
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  creatorName?: string;
  image?: string;
}): Promise<void> {
  const creator = params.creatorName || shortenAddress(params.creator);
  const tokenUrl = `${CLAWDVAULT_URL}/token/${params.mint}`;
  
  const content = `🦞 NEW TOKEN LAUNCHED!

$${params.symbol} - ${params.name}

Created by: ${creator}

🔗 ${tokenUrl}

#ClawdVault #Solana #Memecoins`;

  await postToMoltx(content);
}

/**
 * Announce trade (buy/sell)
 */
export async function announceTrade(params: {
  mint: string;
  symbol: string;
  name: string;
  type: 'buy' | 'sell';
  solAmount: number;
  tokenAmount: number;
  trader: string;
  traderName?: string;
  newPrice?: number;
  marketCap?: number;
  solPriceUsd?: number | null; // SOL price at trade time (from database)
}): Promise<void> {
  const trader = params.traderName || shortenAddress(params.trader);
  const tokenUrl = `${CLAWDVAULT_URL}/token/${params.mint}`;
  
  // Use provided SOL price from database, fallback to fetching if not available
  const solPrice = params.solPriceUsd ?? await getSolPrice();
  
  const emoji = params.type === 'buy' ? '🟢' : '🔴';
  const action = params.type === 'buy' ? 'bought' : 'sold';
  
  const solUsd = solPrice ? ` (${formatUsd(params.solAmount * solPrice)})` : '';
  
  let content = `${emoji} ${trader} ${action} ${formatSol(params.solAmount)} SOL${solUsd} of $${params.symbol}

💰 ${formatTokens(params.tokenAmount)} tokens`;

  if (params.marketCap) {
    const mcapUsd = solPrice ? ` (${formatUsd(params.marketCap * solPrice)})` : '';
    content += `\n🏦 MCap: ${formatSol(params.marketCap)} SOL${mcapUsd}`;
  }

  content += `\n\n🔗 ${tokenUrl}`;

  await postToMoltx(content);
}

/**
 * Announce graduation (token hit 120 SOL)
 */
export async function announceGraduation(params: {
  mint: string;
  symbol: string;
  name: string;
  raydiumPool?: string;
}): Promise<void> {
  const tokenUrl = `${CLAWDVAULT_URL}/token/${params.mint}`;
  
  const content = `🎓 $${params.symbol} GRADUATED!

${params.name} has hit 120 SOL and is migrating to Raydium!

${params.raydiumPool ? `🌊 Pool: ${params.raydiumPool}` : ''}

🔗 ${tokenUrl}

#ClawdVault #Solana #Graduation`;

  await postToMoltx(content);
}

/**
 * Price milestone announcements (optional - for significant pumps)
 */
export async function announceMilestone(params: {
  mint: string;
  symbol: string;
  milestone: string; // e.g., "10 SOL MCap", "2x from launch"
}): Promise<void> {
  const tokenUrl = `${CLAWDVAULT_URL}/token/${params.mint}`;
  
  const content = `🚀 $${params.symbol} hit ${params.milestone}!

🔗 ${tokenUrl}

#ClawdVault`;

  await postToMoltx(content);
}
