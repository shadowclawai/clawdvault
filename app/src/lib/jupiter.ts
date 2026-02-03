/**
 * Jupiter API integration for graduated token swaps
 * 
 * After a token graduates to Raydium, we route trades through Jupiter
 * instead of the bonding curve. This gives users seamless UX.
 */

import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';

const JUPITER_API_URL = 'https://quote-api.jup.ag/v6';
const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112'; // Wrapped SOL

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  routePlan: any[];
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
}

export interface JupiterSwapResult {
  swapTransaction: string; // base64 encoded versioned transaction
  lastValidBlockHeight: number;
}

/**
 * Get a quote for swapping tokens via Jupiter
 */
export async function getJupiterQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: string; // in smallest units (lamports/token units)
  slippageBps?: number; // default 50 = 0.5%
  swapMode?: 'ExactIn' | 'ExactOut';
}): Promise<JupiterQuote> {
  const {
    inputMint,
    outputMint,
    amount,
    slippageBps = 50,
    swapMode = 'ExactIn',
  } = params;

  const url = new URL(`${JUPITER_API_URL}/quote`);
  url.searchParams.set('inputMint', inputMint);
  url.searchParams.set('outputMint', outputMint);
  url.searchParams.set('amount', amount);
  url.searchParams.set('slippageBps', slippageBps.toString());
  url.searchParams.set('swapMode', swapMode);

  const response = await fetch(url.toString());
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Jupiter quote failed: ${error}`);
  }

  return response.json();
}

/**
 * Get a swap transaction from Jupiter
 */
export async function getJupiterSwapTransaction(params: {
  quote: JupiterQuote;
  userPublicKey: string;
  wrapAndUnwrapSol?: boolean;
  dynamicComputeUnitLimit?: boolean;
  prioritizationFeeLamports?: number | 'auto';
}): Promise<JupiterSwapResult> {
  const {
    quote,
    userPublicKey,
    wrapAndUnwrapSol = true,
    dynamicComputeUnitLimit = true,
    prioritizationFeeLamports = 'auto',
  } = params;

  const response = await fetch(`${JUPITER_API_URL}/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey,
      wrapAndUnwrapSol,
      dynamicComputeUnitLimit,
      prioritizationFeeLamports,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Jupiter swap failed: ${error}`);
  }

  return response.json();
}

/**
 * Helper: Get quote for buying tokens with SOL (graduated token)
 */
export async function getGraduatedBuyQuote(params: {
  tokenMint: string;
  solAmount: string; // in lamports
  slippageBps?: number;
}): Promise<JupiterQuote> {
  return getJupiterQuote({
    inputMint: NATIVE_SOL_MINT,
    outputMint: params.tokenMint,
    amount: params.solAmount,
    slippageBps: params.slippageBps,
    swapMode: 'ExactIn',
  });
}

/**
 * Helper: Get quote for selling tokens for SOL (graduated token)
 */
export async function getGraduatedSellQuote(params: {
  tokenMint: string;
  tokenAmount: string; // in token units
  slippageBps?: number;
}): Promise<JupiterQuote> {
  return getJupiterQuote({
    inputMint: params.tokenMint,
    outputMint: NATIVE_SOL_MINT,
    amount: params.tokenAmount,
    slippageBps: params.slippageBps,
    swapMode: 'ExactIn',
  });
}

/**
 * Deserialize a Jupiter swap transaction
 */
export function deserializeJupiterTransaction(
  swapTransaction: string
): VersionedTransaction {
  const transactionBuf = Buffer.from(swapTransaction, 'base64');
  return VersionedTransaction.deserialize(transactionBuf);
}

/**
 * Check if a token has liquidity on Jupiter (is tradeable)
 */
export async function checkJupiterLiquidity(tokenMint: string): Promise<boolean> {
  try {
    // Try to get a small quote
    const quote = await getJupiterQuote({
      inputMint: NATIVE_SOL_MINT,
      outputMint: tokenMint,
      amount: '1000000', // 0.001 SOL
    });
    return !!quote && BigInt(quote.outAmount) > 0;
  } catch {
    return false;
  }
}
