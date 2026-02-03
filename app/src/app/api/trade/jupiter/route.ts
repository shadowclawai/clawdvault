/**
 * Jupiter swap API for graduated tokens
 * 
 * POST /api/trade/jupiter
 * 
 * Routes trades through Jupiter aggregator for tokens that have
 * graduated from the bonding curve to Raydium.
 */

import { NextResponse } from 'next/server';
import { PublicKey, Connection } from '@solana/web3.js';
import { 
  getGraduatedBuyQuote, 
  getGraduatedSellQuote, 
  getJupiterSwapTransaction,
  JupiterQuote,
} from '@/lib/jupiter';
import { findBondingCurvePDA } from '@/lib/anchor/client';

export const dynamic = 'force-dynamic';

// Check if token is graduated by reading on-chain state
async function isTokenGraduated(mint: string): Promise<boolean> {
  try {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');
    const mintPubkey = new PublicKey(mint);
    const [curvePDA] = findBondingCurvePDA(mintPubkey);
    
    const curveAccount = await connection.getAccountInfo(curvePDA);
    if (!curveAccount) return false;
    
    // graduated is at offset 112
    return curveAccount.data[112] === 1;
  } catch {
    return false;
  }
}

/**
 * POST /api/trade/jupiter
 * 
 * Body: {
 *   mint: string,
 *   action: 'buy' | 'sell',
 *   amount: string,  // SOL lamports for buy, token units for sell
 *   userPublicKey: string,
 *   slippageBps?: number  // default 50 = 0.5%
 * }
 * 
 * Returns: {
 *   success: boolean,
 *   quote?: JupiterQuote,
 *   transaction?: string,  // base64 encoded versioned transaction
 *   error?: string
 * }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { mint, action, amount, userPublicKey, slippageBps = 50 } = body;

    // Validate inputs
    if (!mint || !action || !amount || !userPublicKey) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: mint, action, amount, userPublicKey' },
        { status: 400 }
      );
    }

    if (action !== 'buy' && action !== 'sell') {
      return NextResponse.json(
        { success: false, error: 'action must be "buy" or "sell"' },
        { status: 400 }
      );
    }

    // Validate public keys
    try {
      new PublicKey(mint);
      new PublicKey(userPublicKey);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid public key format' },
        { status: 400 }
      );
    }

    // Check if token is graduated
    const graduated = await isTokenGraduated(mint);
    if (!graduated) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Token not graduated. Use /api/trade/prepare for bonding curve trades.',
          graduated: false,
        },
        { status: 400 }
      );
    }

    // Get Jupiter quote
    let quote: JupiterQuote;
    
    if (action === 'buy') {
      quote = await getGraduatedBuyQuote({
        tokenMint: mint,
        solAmount: amount,
        slippageBps,
      });
    } else {
      quote = await getGraduatedSellQuote({
        tokenMint: mint,
        tokenAmount: amount,
        slippageBps,
      });
    }

    // Get swap transaction
    const swapResult = await getJupiterSwapTransaction({
      quote,
      userPublicKey,
    });

    return NextResponse.json({
      success: true,
      graduated: true,
      quote: {
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        inAmount: quote.inAmount,
        outAmount: quote.outAmount,
        priceImpactPct: quote.priceImpactPct,
        slippageBps: quote.slippageBps,
      },
      transaction: swapResult.swapTransaction,
      lastValidBlockHeight: swapResult.lastValidBlockHeight,
    });

  } catch (error: any) {
    console.error('Jupiter swap error:', error);
    
    // Handle Jupiter-specific errors
    if (error.message?.includes('No route found')) {
      return NextResponse.json(
        { success: false, error: 'No liquidity available for this trade' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: error.message || 'Jupiter swap failed' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/trade/jupiter?mint=<address>
 * 
 * Check if a token is graduated and tradeable via Jupiter
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mint = searchParams.get('mint');

    if (!mint) {
      return NextResponse.json(
        { success: false, error: 'mint parameter required' },
        { status: 400 }
      );
    }

    const graduated = await isTokenGraduated(mint);

    return NextResponse.json({
      success: true,
      mint,
      graduated,
      tradeEndpoint: graduated ? '/api/trade/jupiter' : '/api/trade/prepare',
    });

  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to check token status' },
      { status: 500 }
    );
  }
}
