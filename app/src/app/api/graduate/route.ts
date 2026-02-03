import { NextResponse } from 'next/server';
import { getToken } from '@/lib/db';
import { 
  Connection, 
  PublicKey, 
  Keypair,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { 
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from '@solana/spl-token';
import ClawdVaultClient, { findBondingCurvePDA } from '@/lib/anchor/client';
import bs58 from 'bs58';

export const dynamic = 'force-dynamic';

// Get connection based on environment
function getConnection(): Connection {
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');
  return new Connection(rpcUrl, 'confirmed');
}

// Migration wallet keypair (loaded from env)
function getMigrationWallet(): Keypair | null {
  const privateKey = process.env.MIGRATION_WALLET_PRIVATE_KEY;
  if (!privateKey) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(privateKey));
  } catch {
    return null;
  }
}

// Protocol authority keypair (for calling release_for_migration)
function getAuthorityWallet(): Keypair | null {
  const privateKey = process.env.AUTHORITY_WALLET_PRIVATE_KEY;
  if (!privateKey) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(privateKey));
  } catch {
    return null;
  }
}

/**
 * GET /api/graduate?mint=<address>
 * Check graduation status for a token
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

    const token = await getToken(mint);
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Token not found' },
        { status: 404 }
      );
    }

    // Get on-chain state
    const connection = getConnection();
    const mintPubkey = new PublicKey(mint);
    const [curvePDA] = findBondingCurvePDA(mintPubkey);
    
    const curveAccount = await connection.getAccountInfo(curvePDA);
    if (!curveAccount) {
      return NextResponse.json(
        { success: false, error: 'Bonding curve not found on-chain' },
        { status: 404 }
      );
    }

    // Parse curve data (offset 8 for discriminator)
    const data = curveAccount.data;
    // graduated is at offset: 8 + 32 + 32 + 8 + 8 + 8 + 8 + 8 = 112
    const graduated = data[112] === 1;
    // migrated_to_raydium is at offset 113
    const migratedToRaydium = data[113] === 1;
    // real_sol_reserves at offset 8 + 32 + 32 + 8 + 8 = 88
    const realSolReserves = data.readBigUInt64LE(88);
    // real_token_reserves at offset 96
    const realTokenReserves = data.readBigUInt64LE(96);

    return NextResponse.json({
      success: true,
      data: {
        mint,
        graduated,
        migratedToRaydium,
        realSolReserves: realSolReserves.toString(),
        realTokenReserves: realTokenReserves.toString(),
        canMigrate: graduated && !migratedToRaydium,
      }
    });

  } catch (error) {
    console.error('Error checking graduation status:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to check graduation status' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/graduate
 * Trigger graduation for a token (release assets + create Raydium pool)
 * 
 * Body: { mint: string }
 */
export async function POST(request: Request) {
  try {
    // Only allow in development or with proper auth
    if (process.env.NODE_ENV === 'production' && !process.env.ENABLE_GRADUATION_API) {
      return NextResponse.json(
        { success: false, error: 'Graduation API disabled in production' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { mint } = body;
    
    if (!mint) {
      return NextResponse.json(
        { success: false, error: 'mint is required' },
        { status: 400 }
      );
    }

    // Check wallets are configured
    const migrationWallet = getMigrationWallet();
    const authorityWallet = getAuthorityWallet();
    
    if (!migrationWallet || !authorityWallet) {
      return NextResponse.json(
        { success: false, error: 'Migration wallets not configured' },
        { status: 500 }
      );
    }

    // Get token from database
    const token = await getToken(mint);
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Token not found' },
        { status: 404 }
      );
    }

    // Check on-chain status
    const connection = getConnection();
    const mintPubkey = new PublicKey(mint);
    const [curvePDA] = findBondingCurvePDA(mintPubkey);
    
    const curveAccount = await connection.getAccountInfo(curvePDA);
    if (!curveAccount) {
      return NextResponse.json(
        { success: false, error: 'Bonding curve not found on-chain' },
        { status: 404 }
      );
    }

    // Parse curve data
    const data = curveAccount.data;
    const graduated = data[112] === 1;
    const migratedToRaydium = data[113] === 1;
    const realSolReserves = data.readBigUInt64LE(88);
    const realTokenReserves = data.readBigUInt64LE(96);

    if (!graduated) {
      return NextResponse.json(
        { success: false, error: 'Token has not graduated yet' },
        { status: 400 }
      );
    }

    if (migratedToRaydium) {
      return NextResponse.json(
        { success: false, error: 'Token already migrated to Raydium' },
        { status: 400 }
      );
    }

    console.log(`🚀 Starting graduation for ${mint}`);
    console.log(`SOL reserves: ${realSolReserves} lamports`);
    console.log(`Token reserves: ${realTokenReserves}`);

    // Step 1: Ensure migration wallet has token account
    const migrationTokenAccount = await getAssociatedTokenAddress(
      mintPubkey,
      migrationWallet.publicKey
    );
    
    try {
      await getAccount(connection, migrationTokenAccount);
    } catch {
      // Create ATA if it doesn't exist
      console.log('Creating migration token account...');
      const createAtaIx = createAssociatedTokenAccountInstruction(
        authorityWallet.publicKey,
        migrationTokenAccount,
        migrationWallet.publicKey,
        mintPubkey
      );
      const { blockhash } = await connection.getLatestBlockhash();
      const tx = new (await import('@solana/web3.js')).Transaction()
        .add(createAtaIx);
      tx.recentBlockhash = blockhash;
      tx.feePayer = authorityWallet.publicKey;
      await sendAndConfirmTransaction(connection, tx, [authorityWallet]);
    }

    // Step 2: Release assets from curve to migration wallet
    console.log('Releasing assets from curve...');
    const client = new ClawdVaultClient(connection);
    const releaseTx = await client.buildReleaseForMigrationTx(
      authorityWallet.publicKey,
      mintPubkey,
      migrationWallet.publicKey
    );
    
    const releaseSignature = await sendAndConfirmTransaction(
      connection, 
      releaseTx, 
      [authorityWallet]
    );
    console.log(`✅ Assets released: ${releaseSignature}`);

    // Step 3: Create Raydium pool
    // TODO: Implement Raydium SDK integration
    // For now, just mark as migrated and return
    console.log('⚠️ Raydium pool creation not yet implemented');
    console.log('Assets are in migration wallet, manual pool creation required');

    // Note: On-chain state is source of truth
    // Database will sync via trade/candle endpoints reading on-chain data

    return NextResponse.json({
      success: true,
      data: {
        mint,
        releaseSignature,
        migrationWallet: migrationWallet.publicKey.toBase58(),
        solReleased: realSolReserves.toString(),
        tokensReleased: realTokenReserves.toString(),
        raydiumPool: null, // TODO: Return pool address when implemented
        message: 'Assets released to migration wallet. Raydium pool creation pending.',
      }
    });

  } catch (error) {
    console.error('Error during graduation:', error);
    return NextResponse.json(
      { success: false, error: `Graduation failed: ${error}` },
      { status: 500 }
    );
  }
}
