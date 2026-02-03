import { NextResponse } from 'next/server';
import { Connection, clusterApiUrl, Transaction } from '@solana/web3.js';
import { createToken } from '@/lib/db';
import { db } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// Look up username from user_profiles
async function getUsername(wallet: string): Promise<string | null> {
  try {
    const profile = await db().userProfile.findUnique({
      where: { wallet },
      select: { username: true },
    });
    return profile?.username || null;
  } catch {
    return null;
  }
}

// Get connection based on environment
function getConnection(): Connection {
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');
  return new Connection(rpcUrl, 'confirmed');
}

interface ExecuteCreateRequest {
  signedTransaction: string;  // Base64 encoded signed transaction
  mint: string;               // Mint address (for DB record)
  creator: string;            // Creator wallet
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  creatorName?: string;
  initialBuy?: {              // Initial buy info (if any)
    solAmount: number;
    estimatedTokens: number;
  };
}

/**
 * Execute a signed create token transaction
 * POST /api/token/execute-create
 * 
 * Submits the user's signed transaction to the network
 * and records the token in the database
 */
export async function POST(request: Request) {
  try {
    const body: ExecuteCreateRequest = await request.json();
    
    // Validate
    if (!body.signedTransaction || !body.mint || !body.creator || !body.name || !body.symbol) {
      return NextResponse.json(
        { success: false, error: 'signedTransaction, mint, creator, name, and symbol are required' },
        { status: 400 }
      );
    }

    const connection = getConnection();
    
    // Deserialize the signed transaction
    const transactionBuffer = Buffer.from(body.signedTransaction, 'base64');
    
    // Send the transaction
    console.log(`📤 Submitting create token transaction for ${body.symbol}...`);
    
    const signature = await connection.sendRawTransaction(transactionBuffer, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    
    console.log(`📝 Transaction submitted: ${signature}`);
    
    // Wait for confirmation
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    
    if (confirmation.value.err) {
      console.error('❌ Transaction failed:', confirmation.value.err);
      return NextResponse.json({
        success: false,
        error: 'Transaction failed on-chain',
        signature,
        details: confirmation.value.err,
      }, { status: 400 });
    }
    
    console.log(`✅ Token created on-chain: ${signature}`);
    
    // Look up creator's username from user_profiles
    const creatorName = body.creatorName || await getUsername(body.creator) || undefined;
    
    // Record the token in database
    const token = await createToken({
      mint: body.mint,
      name: body.name,
      symbol: body.symbol,
      description: body.description,
      image: body.image,
      creator: body.creator,
      creator_name: creatorName,
      twitter: body.twitter,
      telegram: body.telegram,
      website: body.website,
    });
    
    if (!token) {
      // Token created on-chain but DB failed - still return success with warning
      console.error('Warning: Token created on-chain but failed to save to database');
      return NextResponse.json({
        success: true,
        warning: 'Token created on-chain but database record failed',
        signature,
        mint: body.mint,
        explorer: `https://explorer.solana.com/tx/${signature}?cluster=${
          process.env.SOLANA_NETWORK || 'devnet'
        }`,
      });
    }
    
    // Record initial buy as a trade if there was one
    // IMPORTANT: Use recordTrade() to properly update token reserves!
    let initialBuyTrade = null;
    if (body.initialBuy && body.initialBuy.solAmount > 0) {
      try {
        const { recordTrade } = await import('@/lib/db');
        
        initialBuyTrade = await recordTrade({
          mint: body.mint,
          type: 'buy',
          wallet: body.creator,
          solAmount: body.initialBuy.solAmount,
          tokenAmount: body.initialBuy.estimatedTokens,
          signature: signature,
        });
        
        console.log(`📊 Initial buy trade recorded with reserves update: ${initialBuyTrade?.id}`);
      } catch (tradeErr) {
        console.error('Warning: Failed to record initial buy trade:', tradeErr);
      }
    }
    
    return NextResponse.json({
      success: true,
      token,
      signature,
      mint: body.mint,
      initialBuyTrade: initialBuyTrade ? {
        id: initialBuyTrade.id,
        solAmount: body.initialBuy?.solAmount,
        tokenAmount: body.initialBuy?.estimatedTokens,
      } : null,
      explorer: `https://explorer.solana.com/tx/${signature}?cluster=${
        process.env.SOLANA_NETWORK || 'devnet'
      }`,
    });
    
  } catch (error) {
    console.error('Error executing create token:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create token: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
