import { NextResponse } from 'next/server';
import { getToken } from '@/lib/db';
import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import ClawdVaultClient, { 
  findConfigPDA, 
  findBondingCurvePDA,
  calculateBuyTokensOut,
  calculateSellSolOut,
  PROTOCOL_FEE_BPS,
  CREATOR_FEE_BPS,
  BPS_DENOMINATOR,
} from '@/lib/anchor/client';

export const dynamic = 'force-dynamic';

// Config PDA - protocol fee recipient
const [configPDA] = findConfigPDA();

// Fee recipient (protocol wallet)
const FEE_RECIPIENT = new PublicKey(
  process.env.FEE_RECIPIENT || '7b9191rMLP8yZaKYudWiFtFZwtaEYX5Tyy2hZeEKDyWq'
);

// Get connection based on environment
function getConnection(): Connection {
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');
  return new Connection(rpcUrl, 'confirmed');
}

interface PrepareTradeRequest {
  mint: string;
  type: 'buy' | 'sell';
  amount: number;      // SOL for buy, tokens for sell
  wallet: string;      // User's wallet address
  slippage?: number;   // Slippage tolerance (default 1%)
}

/**
 * Prepare a trade transaction for the user to sign
 * POST /api/trade/prepare
 * 
 * Uses the on-chain Anchor program for non-custodial trading
 */
export async function POST(request: Request) {
  try {
    const body: PrepareTradeRequest = await request.json();
    
    // Validate
    if (!body.mint || !body.type || !body.amount || !body.wallet) {
      return NextResponse.json(
        { success: false, error: 'mint, type, amount, and wallet are required' },
        { status: 400 }
      );
    }

    if (body.type !== 'buy' && body.type !== 'sell') {
      return NextResponse.json(
        { success: false, error: 'type must be "buy" or "sell"' },
        { status: 400 }
      );
    }

    if (body.amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'amount must be positive' },
        { status: 400 }
      );
    }

    // Get token from database
    const token = await getToken(body.mint);
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Token not found' },
        { status: 404 }
      );
    }

    if (token.graduated) {
      // Token graduated - redirect to Jupiter
      return NextResponse.json({
        success: false,
        graduated: true,
        error: 'Token has graduated to Raydium. Use Jupiter endpoint.',
        redirectTo: '/api/trade/jupiter',
        message: 'This token is now tradeable on Raydium via Jupiter aggregator.',
      }, { status: 400 });
    }

    const connection = getConnection();
    const client = new ClawdVaultClient(connection);
    const mintPubkey = new PublicKey(body.mint);
    const walletPubkey = new PublicKey(body.wallet);
    const creatorPubkey = new PublicKey(token.creator);
    
    // Get on-chain bonding curve state
    const curveState = await client.getBondingCurve(mintPubkey);
    if (!curveState) {
      return NextResponse.json(
        { success: false, error: 'Bonding curve not found on-chain' },
        { status: 404 }
      );
    }

    const slippage = body.slippage || 0.01; // 1% default
    
    if (body.type === 'buy') {
      // Buying: spending SOL, receiving tokens
      const solAmountLamports = BigInt(Math.floor(body.amount * 1e9)); // Convert to lamports
      
      const { tokensOut, fee, priceImpact } = calculateBuyTokensOut(
        solAmountLamports,
        curveState.virtualSolReserves,
        curveState.virtualTokenReserves
      );
      
      // Apply slippage to get minimum
      const minTokensOut = (tokensOut * BigInt(Math.floor((1 - slippage) * 10000))) / BigInt(10000);
      
      // Build transaction using Anchor client
      const transaction = await client.buildBuyTransaction(
        walletPubkey,
        mintPubkey,
        solAmountLamports,
        minTokensOut,
        creatorPubkey,
        FEE_RECIPIENT
      );
      
      // Serialize for user to sign
      const serialized = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });
      
      const feeNumber = Number(fee) / 1e9;
      const tokensOutNumber = Number(tokensOut) / 1e6;
      const minTokensOutNumber = Number(minTokensOut) / 1e6;
      
      return NextResponse.json({
        success: true,
        transaction: serialized.toString('base64'),
        type: 'buy',
        input: {
          sol: body.amount,
          fee: feeNumber,
        },
        output: {
          tokens: tokensOutNumber,
          minTokens: minTokensOutNumber,
        },
        priceImpact,
        currentPrice: token.price_sol,
        onChain: true,
      });
      
    } else {
      // Selling: spending tokens, receiving SOL
      let tokenAmountUnits = BigInt(Math.floor(body.amount * 1e6)); // Convert to smallest units
      
      // Check if requested sell would exceed available liquidity
      // If so, calculate max tokens we can actually sell
      const k = curveState.virtualSolReserves * curveState.virtualTokenReserves;
      const targetVirtualSol = curveState.virtualSolReserves - curveState.realSolReserves;
      
      let cappedByLiquidity = false;
      if (targetVirtualSol > BigInt(0)) {
        const maxVirtualTokens = k / targetVirtualSol;
        const maxSellableTokens = maxVirtualTokens - curveState.virtualTokenReserves;
        // Apply 2% buffer for rounding differences between JS and Rust
        const maxSellableWithBuffer = (maxSellableTokens * BigInt(98)) / BigInt(100);
        
        if (tokenAmountUnits > maxSellableWithBuffer) {
          tokenAmountUnits = maxSellableWithBuffer;
          cappedByLiquidity = true;
        }
      }
      
      const { solOut, fee, priceImpact } = calculateSellSolOut(
        tokenAmountUnits,
        curveState.virtualSolReserves,
        curveState.virtualTokenReserves
      );
      
      // Apply normal slippage (now safe since we capped tokens)
      const minSolOut = (solOut * BigInt(Math.floor((1 - slippage) * 10000))) / BigInt(10000);
      
      // Build transaction using Anchor client
      const transaction = await client.buildSellTransaction(
        walletPubkey,
        mintPubkey,
        tokenAmountUnits,
        minSolOut,
        creatorPubkey,
        FEE_RECIPIENT
      );
      
      // Serialize for user to sign
      const serialized = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });
      
      const feeNumber = Number(fee) / 1e9;
      const solOutNumber = Number(solOut) / 1e9;
      const minSolOutNumber = Number(minSolOut) / 1e9;
      
      const actualTokenAmount = Number(tokenAmountUnits) / 1e6;
      
      return NextResponse.json({
        success: true,
        transaction: serialized.toString('base64'),
        type: 'sell',
        input: {
          tokens: actualTokenAmount, // May be less than requested if capped
          requestedTokens: body.amount,
        },
        output: {
          sol: solOutNumber,
          minSol: minSolOutNumber,
          fee: feeNumber,
        },
        priceImpact,
        currentPrice: token.price_sol,
        onChain: true,
        cappedByLiquidity,
      });
    }
    
  } catch (error) {
    console.error('Error preparing trade:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to prepare trade: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
