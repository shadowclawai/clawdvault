import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { isMockMode } from '@/lib/solana';

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

// GET /api/balance?wallet=xxx&mint=yyy - Get token balance for wallet
export async function GET(request: NextRequest) {
  try {
    const wallet = request.nextUrl.searchParams.get('wallet');
    const mint = request.nextUrl.searchParams.get('mint');

    if (!wallet) {
      return NextResponse.json(
        { success: false, error: 'Missing wallet parameter' },
        { status: 400 }
      );
    }

    // Mock mode: return 0 (no real balances)
    if (isMockMode()) {
      return NextResponse.json({
        success: true,
        wallet,
        mint: mint || null,
        tokenBalance: 0,
        mockMode: true,
      });
    }

    // On-chain mode: query actual SPL token balance
    if (!mint) {
      return NextResponse.json({
        success: true,
        wallet,
        mint: null,
        tokenBalance: 0,
        note: 'No mint specified',
      });
    }

    try {
      const connection = new Connection(RPC_URL, 'confirmed');
      const walletPubkey = new PublicKey(wallet);
      const mintPubkey = new PublicKey(mint);

      // Get the associated token account address
      const ata = await getAssociatedTokenAddress(mintPubkey, walletPubkey);

      try {
        // Try to get the token account
        const account = await getAccount(connection, ata);
        const balance = Number(account.amount);
        
        // Assuming 6 decimals (standard for most tokens)
        const decimals = 6;
        const tokenBalance = balance / Math.pow(10, decimals);

        return NextResponse.json({
          success: true,
          wallet,
          mint,
          tokenBalance,
          rawBalance: balance,
          ata: ata.toBase58(),
        });
      } catch (e: any) {
        // Account doesn't exist = 0 balance
        if (e.name === 'TokenAccountNotFoundError') {
          return NextResponse.json({
            success: true,
            wallet,
            mint,
            tokenBalance: 0,
            ata: ata.toBase58(),
            note: 'Token account not found (0 balance)',
          });
        }
        throw e;
      }
    } catch (rpcError: any) {
      console.error('RPC error fetching balance:', rpcError.message);
      // Fallback to 0 on RPC errors
      return NextResponse.json({
        success: true,
        wallet,
        mint,
        tokenBalance: 0,
        error: 'RPC error',
        note: rpcError.message,
      });
    }
  } catch (error) {
    console.error('Error fetching balance:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch balance' },
      { status: 500 }
    );
  }
}
