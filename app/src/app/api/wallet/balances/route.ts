import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

// GET /api/wallet/balances?wallet=xxx - Get all token balances for a wallet
export async function GET(request: NextRequest) {
  try {
    const wallet = request.nextUrl.searchParams.get('wallet');

    if (!wallet) {
      return NextResponse.json(
        { success: false, error: 'Missing wallet parameter' },
        { status: 400 }
      );
    }

    try {
      const connection = new Connection(RPC_URL, 'confirmed');
      const walletPubkey = new PublicKey(wallet);

      // Get all token accounts for this wallet
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        walletPubkey,
        { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
      );

      // Build balance map: mint -> balance
      const balances: Record<string, number> = {};
      
      for (const account of tokenAccounts.value) {
        const parsed = account.account.data.parsed;
        const mint = parsed.info.mint;
        const amount = parseFloat(parsed.info.tokenAmount.uiAmountString || '0');
        
        // Only include non-zero balances
        if (amount > 0) {
          balances[mint] = amount;
        }
      }

      return NextResponse.json({
        success: true,
        wallet,
        balances,
        count: Object.keys(balances).length,
      });
    } catch (rpcError: any) {
      console.error('RPC error fetching balances:', rpcError.message);
      return NextResponse.json({
        success: false,
        error: 'RPC error',
        message: rpcError.message,
      }, { status: 503 });
    }
  } catch (error) {
    console.error('Error fetching balances:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch balances' },
      { status: 500 }
    );
  }
}
