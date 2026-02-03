// ClawdVault Types

export interface Token {
  id: string;
  mint: string;
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  creator: string;
  creator_name?: string;
  created_at: string;
  
  // Bonding curve state
  virtual_sol_reserves: number;
  virtual_token_reserves: number;
  real_sol_reserves: number;
  real_token_reserves: number;
  
  // Computed
  price_sol: number;
  price_usd?: number;
  market_cap_sol: number;
  market_cap_usd?: number;
  
  // Status
  graduated: boolean;
  raydium_pool?: string;
  
  // Social links
  twitter?: string;
  telegram?: string;
  website?: string;
  
  // Stats
  volume_24h?: number;
  trades_24h?: number;
  holders?: number;
}

export interface Trade {
  id: string;
  token_mint: string;
  trader: string;
  type: 'buy' | 'sell';
  sol_amount: number;
  token_amount: number;
  price_sol: number;
  signature: string;
  created_at: string;
}

export interface Agent {
  id: string;
  wallet: string;
  name?: string;
  api_key: string;
  created_at: string;
  
  // Verification
  moltbook_verified?: boolean;
  moltx_verified?: boolean;
  twitter_handle?: string;
  
  // Stats
  tokens_created: number;
  total_volume: number;
}

export interface CreateTokenRequest {
  name: string;
  symbol: string;
  description?: string;
  image?: string;  // URL or base64
  twitter?: string;
  telegram?: string;
  website?: string;
  initialBuy?: number;  // SOL amount to buy at launch
  creator?: string;     // Creator wallet address
  creatorName?: string; // Display name for creator
}

export interface CreateTokenResponse {
  success: boolean;
  token?: Token;
  mint?: string;
  signature?: string;
  error?: string;
  onChain?: boolean;  // True if token was created on real Solana network
}

export interface TradeRequest {
  mint: string;
  type: 'buy' | 'sell';
  amount: number;  // SOL for buy, tokens for sell
  slippage?: number;  // Default 1%
}

export interface TradeResponse {
  success: boolean;
  trade?: Trade;
  signature?: string;
  tokens_received?: number;
  sol_received?: number;
  new_price?: number;
  newPrice?: number;  // Alias for on-chain flow
  fees?: {
    total: number;
    protocol: number;
    creator: number;
  };
  error?: string;
  message?: string;  // Status message (e.g., Jupiter trade success)
  graduated?: boolean;  // True if token graduated during trade
}

export interface TokenListResponse {
  tokens: Token[];
  total: number;
  page: number;
  per_page: number;
}

// Bonding curve math helpers
export const INITIAL_VIRTUAL_SOL = 30;  // 30 SOL
export const INITIAL_VIRTUAL_TOKENS = 1_073_000_000;  // 1.073B tokens
export const GRADUATION_THRESHOLD_SOL = 120; // ~$69K market cap at $100/SOL
export const FEE_BPS = 100;  // 1%

export function calculateBuyTokens(
  virtualSol: number,
  virtualTokens: number,
  solAmount: number
): number {
  const newVirtualSol = virtualSol + solAmount;
  const invariant = virtualSol * virtualTokens;
  const newVirtualTokens = invariant / newVirtualSol;
  return virtualTokens - newVirtualTokens;
}

export function calculateSellSol(
  virtualSol: number,
  virtualTokens: number,
  tokenAmount: number
): number {
  const newVirtualTokens = virtualTokens + tokenAmount;
  const invariant = virtualSol * virtualTokens;
  const newVirtualSol = invariant / newVirtualTokens;
  return virtualSol - newVirtualSol;
}

export function calculatePrice(virtualSol: number, virtualTokens: number): number {
  return virtualSol / virtualTokens;
}

export function calculateMarketCap(virtualSol: number, virtualTokens: number, totalSupply: number): number {
  const price = calculatePrice(virtualSol, virtualTokens);
  return price * totalSupply;
}
