import { NextResponse } from 'next/server';
import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import ClawdVaultClient, { findConfigPDA, PROGRAM_ID, INITIAL_VIRTUAL_SOL, INITIAL_VIRTUAL_TOKENS, TOTAL_FEE_BPS } from '@/lib/anchor/client';
import { db } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function getConnection(): Connection {
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');
  return new Connection(rpcUrl, 'confirmed');
}

interface PrepareBuyRequest {
  buyer: string;
  mint: string;
  solAmount: number;  // SOL amount to spend
  slippageBps?: number;  // Slippage tolerance in basis points (default 100 = 1%)
}

export async function POST(request: Request) {
  try {
    const body: PrepareBuyRequest = await request.json();
    
    if (!body.buyer || !body.mint || !body.solAmount) {
      return NextResponse.json(
        { success: false, error: 'buyer, mint, and solAmount are required' },
        { status: 400 }
      );
    }

    if (body.solAmount <= 0) {
      return NextResponse.json(
        { success: false, error: 'solAmount must be positive' },
        { status: 400 }
      );
    }

    const connection = getConnection();
    const client = new ClawdVaultClient(connection);
    
    const buyerPubkey = new PublicKey(body.buyer);
    const mintPubkey = new PublicKey(body.mint);
    const solAmountLamports = BigInt(Math.floor(body.solAmount * 1e9));
    const slippageBps = body.slippageBps || 100; // 1% default
    
    // Get token info from DB for creator
    const token = await db().token.findUnique({
      where: { mint: body.mint },
    });
    
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Token not found' },
        { status: 404 }
      );
    }
    
    // Get on-chain curve state for accurate quote
    const curveState = await client.getBondingCurve(mintPubkey);
    
    let virtualSol = BigInt(INITIAL_VIRTUAL_SOL);
    let virtualTokens = BigInt(INITIAL_VIRTUAL_TOKENS);
    
    if (curveState) {
      virtualSol = curveState.virtualSolReserves;
      virtualTokens = curveState.virtualTokenReserves;
    }
    
    // Calculate expected tokens out (before slippage)
    const solAfterFee = solAmountLamports * BigInt(10000 - Number(TOTAL_FEE_BPS)) / BigInt(10000);
    const newVirtualSol = virtualSol + solAfterFee;
    const invariant = virtualSol * virtualTokens;
    const newVirtualTokens = invariant / newVirtualSol;
    const tokensOut = virtualTokens - newVirtualTokens;
    
    // Apply slippage tolerance
    const minTokensOut = tokensOut * BigInt(10000 - slippageBps) / BigInt(10000);
    
    // Get fee recipient from config
    const feeRecipient = new PublicKey(process.env.FEE_RECIPIENT_WALLET || body.buyer);
    const creator = new PublicKey(token.creator);
    
    // Build transaction
    const transaction = await client.buildBuyTransaction(
      buyerPubkey,
      mintPubkey,
      solAmountLamports,
      minTokensOut,
      creator,
      feeRecipient
    );
    
    const serialized = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });
    
    return NextResponse.json({
      success: true,
      transaction: serialized.toString('base64'),
      quote: {
        solAmount: body.solAmount,
        solAmountLamports: solAmountLamports.toString(),
        expectedTokens: Number(tokensOut) / 1e6,
        minTokensOut: Number(minTokensOut) / 1e6,
        pricePerToken: body.solAmount / (Number(tokensOut) / 1e6),
        slippageBps,
      },
    });
    
  } catch (error) {
    console.error('Error preparing buy:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to prepare buy: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
