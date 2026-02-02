import { NextResponse } from 'next/server';
import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import ClawdVaultClient, { INITIAL_VIRTUAL_SOL, INITIAL_VIRTUAL_TOKENS, TOTAL_FEE_BPS } from '@/lib/anchor/client';
import { db } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function getConnection(): Connection {
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');
  return new Connection(rpcUrl, 'confirmed');
}

interface PrepareSellRequest {
  seller: string;
  mint: string;
  tokenAmount: number;  // Token amount to sell (in whole tokens)
  slippageBps?: number;  // Slippage tolerance in basis points (default 100 = 1%)
}

export async function POST(request: Request) {
  try {
    const body: PrepareSellRequest = await request.json();
    
    if (!body.seller || !body.mint || !body.tokenAmount) {
      return NextResponse.json(
        { success: false, error: 'seller, mint, and tokenAmount are required' },
        { status: 400 }
      );
    }

    if (body.tokenAmount <= 0) {
      return NextResponse.json(
        { success: false, error: 'tokenAmount must be positive' },
        { status: 400 }
      );
    }

    const connection = getConnection();
    const client = new ClawdVaultClient(connection);
    
    const sellerPubkey = new PublicKey(body.seller);
    const mintPubkey = new PublicKey(body.mint);
    const tokenAmountRaw = BigInt(Math.floor(body.tokenAmount * 1e6)); // 6 decimals
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
    
    // Calculate expected SOL out (before fees)
    const newVirtualTokens = virtualTokens + tokenAmountRaw;
    const invariant = virtualSol * virtualTokens;
    const newVirtualSol = invariant / newVirtualTokens;
    const solOutBeforeFee = virtualSol - newVirtualSol;
    
    // Deduct fees
    const solOutAfterFee = solOutBeforeFee * BigInt(10000 - Number(TOTAL_FEE_BPS)) / BigInt(10000);
    
    // Apply slippage tolerance
    const minSolOut = solOutAfterFee * BigInt(10000 - slippageBps) / BigInt(10000);
    
    // Get fee recipient from config
    const feeRecipient = new PublicKey(process.env.FEE_RECIPIENT_WALLET || body.seller);
    const creator = new PublicKey(token.creator);
    
    // Build transaction
    const transaction = await client.buildSellTransaction(
      sellerPubkey,
      mintPubkey,
      tokenAmountRaw,
      minSolOut,
      creator,
      feeRecipient
    );
    
    const serialized = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });
    
    const expectedSol = Number(solOutAfterFee) / 1e9;
    const minSol = Number(minSolOut) / 1e9;
    
    return NextResponse.json({
      success: true,
      transaction: serialized.toString('base64'),
      quote: {
        tokenAmount: body.tokenAmount,
        tokenAmountRaw: tokenAmountRaw.toString(),
        expectedSol: expectedSol,
        minSolOut: minSol,
        pricePerToken: expectedSol / body.tokenAmount,
        slippageBps,
      },
    });
    
  } catch (error) {
    console.error('Error preparing sell:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to prepare sell: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
