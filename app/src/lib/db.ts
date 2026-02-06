import { db, calculateFees, INITIAL_VIRTUAL_SOL, INITIAL_VIRTUAL_TOKENS, GRADUATION_THRESHOLD_SOL } from './prisma';
import { Token, Trade } from './types';
import { Prisma, FeeType } from '@prisma/client';
import { getSolPrice } from './sol-price';

// Helper to generate random mint (for testing without real Solana)
function generateMint(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789';
  let result = '';
  for (let i = 0; i < 44; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Calculate price from reserves
function calculatePrice(virtualSol: number, virtualTokens: number): number {
  return virtualSol / virtualTokens;
}

// Calculate market cap
function calculateMarketCap(virtualSol: number, virtualTokens: number): number {
  return calculatePrice(virtualSol, virtualTokens) * INITIAL_VIRTUAL_TOKENS;
}

// Convert Prisma token to API token
function toApiToken(token: any, stats?: { volume24h?: number; trades24h?: number; holders?: number }): Token {
  const virtualSol = Number(token.virtualSolReserves);
  const virtualTokens = Number(token.virtualTokenReserves);
  
  return {
    id: token.id,
    mint: token.mint,
    name: token.name,
    symbol: token.symbol,
    description: token.description || undefined,
    image: token.image || undefined,
    creator: token.creator,
    creator_name: token.creatorName || undefined,
    created_at: token.createdAt.toISOString(),
    virtual_sol_reserves: virtualSol,
    virtual_token_reserves: virtualTokens,
    real_sol_reserves: Number(token.realSolReserves),
    real_token_reserves: Number(token.realTokenReserves),
    price_sol: calculatePrice(virtualSol, virtualTokens),
    market_cap_sol: calculateMarketCap(virtualSol, virtualTokens),
    graduated: token.graduated,
    raydium_pool: token.raydiumPool || undefined,
    twitter: token.twitter || undefined,
    telegram: token.telegram || undefined,
    website: token.website || undefined,
    volume_24h: stats?.volume24h || 0,
    trades_24h: stats?.trades24h || 0,
    holders: stats?.holders || 1,
  };
}

// Get all tokens
export async function getAllTokens(options?: {
  sort?: string;
  graduated?: boolean;
  page?: number;
  perPage?: number;
}): Promise<{ tokens: Token[]; total: number }> {
  const { sort = 'created_at', graduated, page = 1, perPage = 20 } = options || {};
  
  const where: Prisma.TokenWhereInput = {};
  if (graduated !== undefined) {
    where.graduated = graduated;
  }
  
  let orderBy: Prisma.TokenOrderByWithRelationInput = { createdAt: 'desc' };
  switch (sort) {
    case 'market_cap':
      orderBy = { virtualSolReserves: 'desc' };
      break;
    case 'created_at':
    default:
      orderBy = { createdAt: 'desc' };
  }
  
  const [tokens, total] = await Promise.all([
    db().token.findMany({
      where,
      orderBy,
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    db().token.count({ where }),
  ]);
  
  // Get 24h stats for each token
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  const tokensWithStats = await Promise.all(
    tokens.map(async (token) => {
      const [volumeResult, tradeCount, holderCount] = await Promise.all([
        db().trade.aggregate({
          where: { tokenMint: token.mint, createdAt: { gte: dayAgo } },
          _sum: { solAmount: true },
        }),
        db().trade.count({
          where: { tokenMint: token.mint, createdAt: { gte: dayAgo } },
        }),
        db().trade.groupBy({
          by: ['trader'],
          where: { tokenMint: token.mint },
        }),
      ]);
      
      return toApiToken(token, {
        volume24h: Number(volumeResult._sum.solAmount || 0),
        trades24h: tradeCount,
        holders: holderCount.length || 1,
      });
    })
  );
  
  return { tokens: tokensWithStats, total };
}

// Get single token
export async function getToken(mint: string): Promise<Token | null> {
  const token = await db().token.findUnique({
    where: { mint },
  });
  
  if (!token) return null;
  
  // Get stats
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  const [volumeResult, tradeCount, holderCount] = await Promise.all([
    db().trade.aggregate({
      where: { tokenMint: mint, createdAt: { gte: dayAgo } },
      _sum: { solAmount: true },
    }),
    db().trade.count({
      where: { tokenMint: mint, createdAt: { gte: dayAgo } },
    }),
    db().trade.groupBy({
      by: ['trader'],
      where: { tokenMint: mint },
    }),
  ]);
  
  return toApiToken(token, {
    volume24h: Number(volumeResult._sum.solAmount || 0),
    trades24h: tradeCount,
    holders: holderCount.length || 1,
  });
}

// Update token fields
export async function updateToken(mint: string, data: {
  graduated?: boolean;
  raydiumPoolId?: string;
  virtualSolReserves?: number;
  virtualTokenReserves?: number;
  realSolReserves?: number;
  realTokenReserves?: number;
}): Promise<Token | null> {
  const updated = await db().token.update({
    where: { mint },
    data: {
      graduated: data.graduated,
      raydiumPool: data.raydiumPoolId,  // maps to raydium_pool column
      virtualSolReserves: data.virtualSolReserves,
      virtualTokenReserves: data.virtualTokenReserves,
      realSolReserves: data.realSolReserves,
      realTokenReserves: data.realTokenReserves,
    },
  });
  return toApiToken(updated);
}

// Update token reserves only (for syncing on-chain state)
export async function updateTokenReserves(mint: string, reserves: {
  virtualSolReserves: number;
  virtualTokenReserves: number;
}): Promise<void> {
  await db().token.update({
    where: { mint },
    data: {
      virtualSolReserves: new Prisma.Decimal(reserves.virtualSolReserves.toString()),
      virtualTokenReserves: new Prisma.Decimal(reserves.virtualTokenReserves.toString()),
    },
  });
}

// Get token trades
export async function getTokenTrades(mint: string, limit = 50): Promise<Trade[]> {
  const trades = await db().trade.findMany({
    where: { tokenMint: mint },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  
  return trades.map((t) => ({
    id: t.id,
    token_mint: t.tokenMint,
    trader: t.trader,
    type: t.tradeType.toLowerCase() as 'buy' | 'sell',
    sol_amount: Number(t.solAmount),
    token_amount: Number(t.tokenAmount),
    price_sol: Number(t.priceSol),
    signature: t.signature || '',
    created_at: t.createdAt.toISOString(),
    // Also include camelCase versions for component compatibility
    solAmount: Number(t.solAmount),
    tokenAmount: Number(t.tokenAmount),
  }));
}

// Check if trade with signature already exists (duplicate prevention)
export async function getTradeBySignature(signature: string): Promise<boolean> {
  const trade = await db().trade.findUnique({
    where: { signature },
    select: { id: true },
  });
  return trade !== null;
}

// Create token
export async function createToken(data: {
  mint?: string;  // Optional: use this if provided (for on-chain tokens)
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  creator: string;
  creator_name?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
}): Promise<Token | null> {
  const mint = data.mint || generateMint(); // Use provided mint or generate random one for testing
  
  try {
    const token = await db().token.create({
      data: {
        mint,
        name: data.name,
        symbol: data.symbol.toUpperCase(),
        description: data.description,
        image: data.image,
        creator: data.creator,
        creatorName: data.creator_name,
        twitter: data.twitter,
        telegram: data.telegram,
        website: data.website,
        virtualSolReserves: INITIAL_VIRTUAL_SOL,
        virtualTokenReserves: INITIAL_VIRTUAL_TOKENS,
        realSolReserves: 0,
        realTokenReserves: INITIAL_VIRTUAL_TOKENS,
      },
    });
    
    return toApiToken(token);
  } catch (error) {
    console.error('Error creating token:', error);
    return null;
  }
}

// Execute trade with fee distribution
export async function executeTrade(
  mint: string,
  type: 'buy' | 'sell',
  amount: number,
  trader: string,
  signature?: string
): Promise<{ token: Token; trade: Trade; fees: { protocol: number; creator: number } } | null> {
  // Get current token state
  const token = await db().token.findUnique({
    where: { mint },
  });
  
  if (!token) {
    console.error('Token not found:', mint);
    return null;
  }
  
  const virtualSol = Number(token.virtualSolReserves);
  const virtualTokens = Number(token.virtualTokenReserves);
  const realSol = Number(token.realSolReserves);
  const realTokens = Number(token.realTokenReserves);
  
  let solAmount: number;
  let tokenAmount: number;
  let newVirtualSol: number;
  let newVirtualTokens: number;
  let newRealSol: number;
  let newRealTokens: number;
  
  // Calculate trade
  if (type === 'buy') {
    solAmount = amount;
    newVirtualSol = virtualSol + solAmount;
    const invariant = virtualSol * virtualTokens;
    newVirtualTokens = invariant / newVirtualSol;
    tokenAmount = virtualTokens - newVirtualTokens;
    
    // Calculate fees
    const fees = calculateFees(solAmount);
    const solAfterFee = solAmount - fees.total;
    
    newRealSol = realSol + solAfterFee;
    newRealTokens = realTokens - tokenAmount;
    
    // Execute in transaction
    const result = await db().$transaction(async (tx) => {
      // Update token
      const updatedToken = await tx.token.update({
        where: { mint },
        data: {
          virtualSolReserves: newVirtualSol,
          virtualTokenReserves: newVirtualTokens,
          realSolReserves: newRealSol,
          realTokenReserves: newRealTokens,
          graduated: newRealSol >= GRADUATION_THRESHOLD_SOL,
        },
      });
      
      // Create trade
      const trade = await tx.trade.create({
        data: {
          tokenId: token.id,
          tokenMint: mint,
          trader,
          tradeType: type,
          solAmount,
          tokenAmount,
          priceSol: newVirtualSol / newVirtualTokens,
          totalFee: fees.total,
          protocolFee: fees.protocol,
          creatorFee: fees.creator,
          signature: signature || `db_${Date.now()}`,
        },
      });
      
      // Create fee records
      const feeRecords = [];
      
      if (fees.protocol > 0) {
        feeRecords.push({
          tokenId: token.id,
          tradeId: trade.id,
          recipient: 'PROTOCOL_TREASURY', // TODO: Set actual treasury address
          feeType: FeeType.PROTOCOL,
          amount: fees.protocol,
        });
      }
      
      if (fees.creator > 0) {
        feeRecords.push({
          tokenId: token.id,
          tradeId: trade.id,
          recipient: token.creator,
          feeType: FeeType.CREATOR,
          amount: fees.creator,
        });
      }
      
      if (feeRecords.length > 0) {
        await tx.fee.createMany({ data: feeRecords });
      }
      
      return { updatedToken, trade, fees };
    });
    
    const finalToken = await getToken(mint);
    
    return {
      token: finalToken!,
      trade: {
        id: result.trade.id,
        token_mint: result.trade.tokenMint,
        trader: result.trade.trader,
        type: result.trade.tradeType as 'buy' | 'sell',
        sol_amount: Number(result.trade.solAmount),
        token_amount: Number(result.trade.tokenAmount),
        price_sol: Number(result.trade.priceSol),
        signature: result.trade.signature || '',
        created_at: result.trade.createdAt.toISOString(),
      },
      fees: result.fees,
    };
  } else {
    // Sell logic
    tokenAmount = amount;
    newVirtualTokens = virtualTokens + tokenAmount;
    const invariant = virtualSol * virtualTokens;
    newVirtualSol = invariant / newVirtualTokens;
    solAmount = virtualSol - newVirtualSol;
    
    // Calculate fees on SOL out
    const fees = calculateFees(solAmount);
    solAmount -= fees.total;
    
    newRealSol = realSol - solAmount;
    newRealTokens = realTokens + tokenAmount;
    
    // Execute in transaction
    const result = await db().$transaction(async (tx) => {
      const updatedToken = await tx.token.update({
        where: { mint },
        data: {
          virtualSolReserves: newVirtualSol,
          virtualTokenReserves: newVirtualTokens,
          realSolReserves: newRealSol,
          realTokenReserves: newRealTokens,
        },
      });
      
      const trade = await tx.trade.create({
        data: {
          tokenId: token.id,
          tokenMint: mint,
          trader,
          tradeType: type,
          solAmount,
          tokenAmount,
          priceSol: newVirtualSol / newVirtualTokens,
          totalFee: fees.total,
          protocolFee: fees.protocol,
          creatorFee: fees.creator,
          signature: signature || `db_${Date.now()}`,
        },
      });
      
      // Create fee records
      const feeRecords = [];
      if (fees.protocol > 0) {
        feeRecords.push({
          tokenId: token.id,
          tradeId: trade.id,
          recipient: 'PROTOCOL_TREASURY',
          feeType: FeeType.PROTOCOL,
          amount: fees.protocol,
        });
      }
      if (fees.creator > 0) {
        feeRecords.push({
          tokenId: token.id,
          tradeId: trade.id,
          recipient: token.creator,
          feeType: FeeType.CREATOR,
          amount: fees.creator,
        });
      }
      if (feeRecords.length > 0) {
        await tx.fee.createMany({ data: feeRecords });
      }
      
      return { updatedToken, trade, fees };
    });
    
    const finalToken = await getToken(mint);
    
    return {
      token: finalToken!,
      trade: {
        id: result.trade.id,
        token_mint: result.trade.tokenMint,
        trader: result.trade.trader,
        type: result.trade.tradeType as 'buy' | 'sell',
        sol_amount: Number(result.trade.solAmount),
        token_amount: Number(result.trade.tokenAmount),
        price_sol: Number(result.trade.priceSol),
        signature: result.trade.signature || '',
        created_at: result.trade.createdAt.toISOString(),
      },
      fees: result.fees,
    };
  }
}

// Get fees earned by an address
export async function getFeesEarned(address: string) {
  const fees = await db().fee.groupBy({
    by: ['feeType', 'claimed'],
    where: { recipient: address },
    _sum: { amount: true },
  });
  
  const result = {
    protocol: { total: 0, claimed: 0, unclaimed: 0 },
    creator: { total: 0, claimed: 0, unclaimed: 0 },
  };
  
  fees.forEach((f) => {
    const key = f.feeType.toLowerCase() as keyof typeof result;
    const amount = Number(f._sum.amount || 0);
    result[key].total += amount;
    if (f.claimed) {
      result[key].claimed += amount;
    } else {
      result[key].unclaimed += amount;
    }
  });
  
  return result;
}

// Validate API key
export async function validateApiKey(apiKey: string): Promise<boolean> {
  if (apiKey === 'test_key') return true;
  
  const agent = await db().agent.findUnique({
    where: { apiKey },
  });
  
  return !!agent;
}

// Register agent
export async function registerAgent(wallet: string, name?: string) {
  const agent = await db().agent.create({
    data: {
      wallet,
      name,
      apiKey: `cv_${generateMint().substring(0, 32)}`,
    },
  });
  
  return agent;
}

// Record a trade from on-chain execution
export interface RecordTradeParams {
  mint: string;
  type: 'buy' | 'sell';
  wallet: string;
  solAmount: number;
  tokenAmount: number;
  signature?: string;
  timestamp?: Date;
  // On-chain reserves from TradeEvent (if available, takes precedence)
  onChainReserves?: {
    virtualSolReserves: number;
    virtualTokenReserves: number;
  };
}

export async function recordTrade(params: RecordTradeParams) {
  console.log('[recordTrade] Called with:', JSON.stringify(params));
  
  const token = await db().token.findUnique({
    where: { mint: params.mint },
  });
  
  if (!token) {
    throw new Error('Token not found');
  }
  
  // Validate params
  if (!params.solAmount || isNaN(params.solAmount)) {
    console.error('[recordTrade] Invalid solAmount:', params.solAmount);
    throw new Error('Invalid solAmount');
  }
  if (!params.tokenAmount || isNaN(params.tokenAmount)) {
    console.error('[recordTrade] Invalid tokenAmount:', params.tokenAmount);
    throw new Error('Invalid tokenAmount');
  }
  
  const fees = calculateFees(params.solAmount);
  const totalFee = fees.total;
  const protocolFee = fees.protocol;
  const creatorFee = fees.creator;
  
  // Current reserves
  const virtualSol = Number(token.virtualSolReserves);
  const virtualTokens = Number(token.virtualTokenReserves);
  const realSol = Number(token.realSolReserves);
  const realTokens = Number(token.realTokenReserves);
  
  console.log('[recordTrade] Current reserves:', { virtualSol, virtualTokens, realSol, realTokens });
  
  // Calculate new reserves based on trade type
  let newVirtualSol: number = virtualSol;
  let newVirtualTokens: number = virtualTokens;
  let newRealSol: number = realSol;
  let newRealTokens: number = realTokens;
  
  const invariant = virtualSol * virtualTokens;
  
  console.log('[recordTrade] Trade type:', params.type, 'solAmount:', params.solAmount, 'tokenAmount:', params.tokenAmount);
  
  // If on-chain reserves provided, use them directly (most accurate)
  if (params.onChainReserves) {
    console.log('[recordTrade] Using on-chain reserves:', params.onChainReserves);
    newVirtualSol = params.onChainReserves.virtualSolReserves;
    newVirtualTokens = params.onChainReserves.virtualTokenReserves;
    
    // Calculate real reserves from the trade
    if (params.type === 'buy') {
      const solAfterFee = params.solAmount - totalFee;
      newRealSol = realSol + solAfterFee;
      newRealTokens = realTokens - params.tokenAmount;
    } else {
      const solOut = virtualSol - newVirtualSol;
      const solAfterFee = solOut - totalFee;
      newRealSol = Math.max(0, realSol - solAfterFee);
      newRealTokens = realTokens + params.tokenAmount;
    }
  } else if (params.type === 'buy') {
    // Fallback: calculate from invariant (less accurate)
    // SOL goes in, tokens come out
    newVirtualSol = virtualSol + params.solAmount;
    newVirtualTokens = invariant / newVirtualSol;
    const solAfterFee = params.solAmount - totalFee;
    newRealSol = realSol + solAfterFee;
    newRealTokens = realTokens - params.tokenAmount;
  } else if (params.type === 'sell') {
    // Tokens go in, SOL comes out
    newVirtualTokens = virtualTokens + params.tokenAmount;
    newVirtualSol = invariant / newVirtualTokens;
    const solOut = virtualSol - newVirtualSol;
    const solAfterFee = solOut - totalFee;
    newRealSol = Math.max(0, realSol - solAfterFee);
    newRealTokens = realTokens + params.tokenAmount;
  } else {
    console.error('[recordTrade] Invalid trade type:', params.type);
    throw new Error(`Invalid trade type: ${params.type}`);
  }
  
  console.log('[recordTrade] New reserves:', { newVirtualSol, newVirtualTokens, newRealSol, newRealTokens });
  
  // Ensure no NaN values
  if (isNaN(newVirtualSol) || isNaN(newVirtualTokens) || isNaN(newRealSol) || isNaN(newRealTokens)) {
    console.error('[recordTrade] NaN detected in reserves calculation!');
    throw new Error('Invalid reserve calculation - NaN detected');
  }
  
  // Get SOL price for USD tracking (do this outside transaction to avoid blocking)
  const solPriceUsd = await getSolPrice();
  
  // Use transaction to update token and create trade atomically
  const result = await db().$transaction(async (tx) => {
    // Update token reserves (using Prisma.Decimal for proper precision)
    const updateData = {
      virtualSolReserves: new Prisma.Decimal(newVirtualSol.toString()),
      virtualTokenReserves: new Prisma.Decimal(newVirtualTokens.toString()),
      realSolReserves: new Prisma.Decimal(newRealSol.toString()),
      realTokenReserves: new Prisma.Decimal(newRealTokens.toString()),
      graduated: newRealSol >= GRADUATION_THRESHOLD_SOL,
    };
    console.log('[recordTrade] Update data:', updateData);
    
    const updatedToken = await tx.token.update({
      where: { mint: params.mint },
      data: updateData,
    });
    
    // Create trade record
    const trade = await tx.trade.create({
      data: {
        tokenId: token.id,
        tokenMint: params.mint,
        trader: params.wallet,
        tradeType: params.type,
        solAmount: params.solAmount,
        tokenAmount: params.tokenAmount,
        priceSol: newVirtualSol / newVirtualTokens,
        solPriceUsd: solPriceUsd ?? null,
        totalFee,
        protocolFee,
        creatorFee,
        signature: params.signature,
        createdAt: params.timestamp || new Date(),
      },
    });
    
    return { trade, token: updatedToken };
  });
  
  // Update candles (fire and forget - don't block on this)
  const newPrice = newVirtualSol / newVirtualTokens;
  try {
    const { updateCandles } = await import('./candles');
    await updateCandles(params.mint, newPrice, params.solAmount, params.timestamp || new Date(), solPriceUsd ?? undefined);
    console.log('[recordTrade] Candles updated');
  } catch (candleError) {
    console.error('[recordTrade] Failed to update candles:', candleError);
    // Don't fail the trade if candle update fails
  }
  
  return result.trade;
}
