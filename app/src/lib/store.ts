// In-memory store for development/testing
// TODO: Replace with Supabase

import { Token, Trade, Agent, INITIAL_VIRTUAL_SOL, INITIAL_VIRTUAL_TOKENS, calculatePrice, calculateMarketCap } from './types';

// In-memory data store (for testing only - production uses database)
const tokens: Map<string, Token> = new Map();
const trades: Trade[] = [];
const agents: Map<string, Agent> = new Map();

// Generate random mint address (for testing)
function generateMint(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789';
  let result = '';
  for (let i = 0; i < 44; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Initialize with some test tokens
function initTestData() {
  if (tokens.size > 0) return;
  
  const testTokens = [
    { name: 'Wolf Pack Alpha', symbol: 'WPACK', creator: 'ShadowClawAI' },
    { name: 'Degen Dreams', symbol: 'DEGEN', creator: 'Anonymous' },
    { name: 'Moon Mission', symbol: 'MOON', creator: 'LunaBot' },
  ];
  
  testTokens.forEach((t, i) => {
    const mint = generateMint();
    const virtualSol = INITIAL_VIRTUAL_SOL + (Math.random() * 10);
    const virtualTokens = INITIAL_VIRTUAL_TOKENS - (Math.random() * 100000000);
    
    tokens.set(mint, {
      id: `token_${i}`,
      mint,
      name: t.name,
      symbol: t.symbol,
      description: `A token by ${t.creator}`,
      creator: generateMint(),
      creator_name: t.creator,
      created_at: new Date(Date.now() - Math.random() * 86400000).toISOString(),
      virtual_sol_reserves: virtualSol,
      virtual_token_reserves: virtualTokens,
      real_sol_reserves: virtualSol - INITIAL_VIRTUAL_SOL,
      real_token_reserves: virtualTokens,
      price_sol: calculatePrice(virtualSol, virtualTokens),
      market_cap_sol: calculateMarketCap(virtualSol, virtualTokens, INITIAL_VIRTUAL_TOKENS),
      graduated: false,
      volume_24h: Math.random() * 100,
      trades_24h: Math.floor(Math.random() * 50),
      holders: Math.floor(Math.random() * 100) + 1,
    });
  });
}

// Store functions
export function getAllTokens(): Token[] {
  initTestData();
  return Array.from(tokens.values())
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function getToken(mint: string): Token | undefined {
  initTestData();
  return tokens.get(mint);
}

export function createToken(data: {
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  creator: string;
  creator_name?: string;
}): Token {
  const mint = generateMint();
  const token: Token = {
    id: `token_${Date.now()}`,
    mint,
    name: data.name,
    symbol: data.symbol.toUpperCase(),
    description: data.description,
    image: data.image,
    creator: data.creator,
    creator_name: data.creator_name,
    created_at: new Date().toISOString(),
    virtual_sol_reserves: INITIAL_VIRTUAL_SOL,
    virtual_token_reserves: INITIAL_VIRTUAL_TOKENS,
    real_sol_reserves: 0,
    real_token_reserves: INITIAL_VIRTUAL_TOKENS,
    price_sol: calculatePrice(INITIAL_VIRTUAL_SOL, INITIAL_VIRTUAL_TOKENS),
    market_cap_sol: calculateMarketCap(INITIAL_VIRTUAL_SOL, INITIAL_VIRTUAL_TOKENS, INITIAL_VIRTUAL_TOKENS),
    graduated: false,
    volume_24h: 0,
    trades_24h: 0,
    holders: 1,
  };
  
  tokens.set(mint, token);
  return token;
}

export function executeTrade(
  mint: string,
  type: 'buy' | 'sell',
  amount: number,
  trader: string
): { token: Token; trade: Trade } | null {
  const token = tokens.get(mint);
  if (!token) return null;
  
  let solAmount: number;
  let tokenAmount: number;
  
  if (type === 'buy') {
    solAmount = amount;
    // Calculate tokens out
    const newVirtualSol = token.virtual_sol_reserves + solAmount;
    const invariant = token.virtual_sol_reserves * token.virtual_token_reserves;
    const newVirtualTokens = invariant / newVirtualSol;
    tokenAmount = token.virtual_token_reserves - newVirtualTokens;
    
    // Apply 1% fee
    const fee = solAmount * 0.01;
    const solAfterFee = solAmount - fee;
    
    // Update token state
    token.virtual_sol_reserves = newVirtualSol;
    token.virtual_token_reserves = newVirtualTokens;
    token.real_sol_reserves += solAfterFee;
    token.real_token_reserves -= tokenAmount;
  } else {
    tokenAmount = amount;
    // Calculate SOL out
    const newVirtualTokens = token.virtual_token_reserves + tokenAmount;
    const invariant = token.virtual_sol_reserves * token.virtual_token_reserves;
    const newVirtualSol = invariant / newVirtualTokens;
    solAmount = token.virtual_sol_reserves - newVirtualSol;
    
    // Apply 1% fee
    const fee = solAmount * 0.01;
    solAmount -= fee;
    
    // Update token state
    token.virtual_sol_reserves = newVirtualSol;
    token.virtual_token_reserves = newVirtualTokens;
    token.real_sol_reserves -= solAmount;
    token.real_token_reserves += tokenAmount;
  }
  
  // Update price and market cap
  token.price_sol = calculatePrice(token.virtual_sol_reserves, token.virtual_token_reserves);
  token.market_cap_sol = calculateMarketCap(token.virtual_sol_reserves, token.virtual_token_reserves, INITIAL_VIRTUAL_TOKENS);
  token.volume_24h = (token.volume_24h || 0) + solAmount;
  token.trades_24h = (token.trades_24h || 0) + 1;
  
  // Check graduation
  if (token.real_sol_reserves >= 85) {  // ~$69K at $800 SOL
    token.graduated = true;
  }
  
  const trade: Trade = {
    id: `trade_${Date.now()}`,
    token_mint: mint,
    trader,
    type,
    sol_amount: solAmount,
    token_amount: tokenAmount,
    price_sol: token.price_sol,
    signature: generateMint(),
    created_at: new Date().toISOString(),
  };
  
  trades.push(trade);
  tokens.set(mint, token);
  
  return { token, trade };
}

export function getTokenTrades(mint: string): Trade[] {
  return trades.filter(t => t.token_mint === mint)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

// Agent functions
export function createAgent(wallet: string, name?: string): Agent {
  const apiKey = `cv_${generateMint().substring(0, 32)}`;
  const agent: Agent = {
    id: `agent_${Date.now()}`,
    wallet,
    name,
    api_key: apiKey,
    created_at: new Date().toISOString(),
    tokens_created: 0,
    total_volume: 0,
  };
  agents.set(apiKey, agent);
  return agent;
}

export function getAgentByKey(apiKey: string): Agent | undefined {
  return agents.get(apiKey);
}

export function validateApiKey(apiKey: string): boolean {
  return agents.has(apiKey) || apiKey === 'test_key';  // Allow test key for dev
}
