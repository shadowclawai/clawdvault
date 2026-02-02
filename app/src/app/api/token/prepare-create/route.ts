import { NextResponse } from 'next/server';
import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import ClawdVaultClient, { findConfigPDA, PROGRAM_ID } from '@/lib/anchor/client';
import bs58 from 'bs58';

export const dynamic = 'force-dynamic';

// Get connection based on environment
function getConnection(): Connection {
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');
  return new Connection(rpcUrl, 'confirmed');
}

interface PrepareCreateRequest {
  creator: string;      // Creator wallet address
  name: string;
  symbol: string;
  uri?: string;         // Metadata URI (optional)
  initialBuy?: number;  // Initial buy in SOL (optional)
}

/**
 * Prepare a create token transaction for the user to sign
 * POST /api/token/prepare-create
 * 
 * Returns the unsigned transaction + mint keypair (secret key encoded)
 * The frontend must include the mint keypair when signing
 */
export async function POST(request: Request) {
  try {
    const body: PrepareCreateRequest = await request.json();
    
    // Validate
    if (!body.creator || !body.name || !body.symbol) {
      return NextResponse.json(
        { success: false, error: 'creator, name, and symbol are required' },
        { status: 400 }
      );
    }

    if (body.name.length > 32) {
      return NextResponse.json(
        { success: false, error: 'Name must be 32 characters or less' },
        { status: 400 }
      );
    }

    if (body.symbol.length > 10) {
      return NextResponse.json(
        { success: false, error: 'Symbol must be 10 characters or less' },
        { status: 400 }
      );
    }

    // Verify Anchor program is deployed
    const connection = getConnection();
    const [configPDA] = findConfigPDA();
    const configAccount = await connection.getAccountInfo(configPDA);
    
    if (!configAccount) {
      return NextResponse.json(
        { success: false, error: 'ClawdVault program not initialized on this network' },
        { status: 503 }
      );
    }

    const client = new ClawdVaultClient(connection);
    const creatorPubkey = new PublicKey(body.creator);
    
    // Generate new mint keypair
    const mintKeypair = Keypair.generate();
    
    // Calculate initial buy in lamports
    const initialBuyLamports = body.initialBuy 
      ? BigInt(Math.floor(body.initialBuy * 1e9)) 
      : BigInt(0);
    
    // Construct metadata URI - points to our API endpoint
    // This returns Metaplex-compatible JSON with name, symbol, description, image
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://clawdvault.com';
    const metadataUri = `${baseUrl}/api/metadata/${mintKeypair.publicKey.toBase58()}`;
    
    // Build transaction
    const transaction = await client.buildCreateTokenTransaction(
      creatorPubkey,
      mintKeypair,
      body.name,
      body.symbol,
      metadataUri,  // Use metadata URI instead of raw image
      initialBuyLamports
    );
    
    // The mint keypair needs to sign the transaction
    // We'll partially sign it here and return it
    transaction.partialSign(mintKeypair);
    
    // Serialize for user to sign
    const serialized = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });
    
    // Calculate estimated tokens for initial buy
    let estimatedTokens = 0;
    if (initialBuyLamports > 0) {
      const solAfterFee = Number(initialBuyLamports) * 0.99; // 1% fee
      const virtualSol = 30e9; // Initial 30 SOL
      const virtualTokens = 1e15; // Initial 1B tokens with 6 decimals
      const newVirtualSol = virtualSol + solAfterFee;
      const invariant = virtualSol * virtualTokens;
      const newVirtualTokens = invariant / newVirtualSol;
      estimatedTokens = (virtualTokens - newVirtualTokens) / 1e6; // Convert to whole tokens
    }
    
    return NextResponse.json({
      success: true,
      transaction: serialized.toString('base64'),
      mint: mintKeypair.publicKey.toBase58(),
      programId: PROGRAM_ID.toBase58(),
      network: process.env.SOLANA_NETWORK || 'devnet',
      initialBuy: body.initialBuy ? {
        sol: body.initialBuy,
        estimatedTokens: Math.floor(estimatedTokens),
      } : null,
    });
    
  } catch (error) {
    console.error('Error preparing create token:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to prepare transaction: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
