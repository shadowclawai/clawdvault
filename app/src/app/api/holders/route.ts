import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { isMockMode, getPlatformWalletPubkey } from '@/lib/solana';

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

export const dynamic = 'force-dynamic';

interface Holder {
  address: string;
  balance: number;
  percentage: number;
  label?: string; // "Bonding Curve", "Dev", etc.
}

// GET /api/holders?mint=xxx&creator=xxx
export async function GET(request: NextRequest) {
  const mint = request.nextUrl.searchParams.get('mint');
  const creator = request.nextUrl.searchParams.get('creator');
  
  if (!mint) {
    return NextResponse.json(
      { success: false, error: 'Missing mint parameter' },
      { status: 400 }
    );
  }

  // Mock mode: return empty holders
  if (isMockMode()) {
    return NextResponse.json({
      success: true,
      mint,
      holders: [],
      totalSupply: 1_000_000_000,
      circulatingSupply: 0,
      mockMode: true,
    });
  }

  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const mintPubkey = new PublicKey(mint);
    const platformWallet = getPlatformWalletPubkey();

    // Get largest token accounts (top holders)
    const largestAccounts = await connection.getTokenLargestAccounts(mintPubkey);
    
    // Get total supply
    const supplyInfo = await connection.getTokenSupply(mintPubkey);
    const totalSupply = Number(supplyInfo.value.uiAmount) || 1_000_000_000;

    // Process holders
    const holders: Holder[] = [];
    let bondingCurveBalance = 0;

    for (const account of largestAccounts.value) {
      const balance = Number(account.uiAmount) || 0;
      if (balance === 0) continue;

      const percentage = (balance / totalSupply) * 100;
      
      // Get the owner of this token account
      const accountInfo = await connection.getParsedAccountInfo(account.address);
      const owner = (accountInfo.value?.data as any)?.parsed?.info?.owner;
      
      // Check if this is the platform wallet (bonding curve) or creator
      const isPlatform = owner === platformWallet;
      const isCreator = creator && owner === creator;
      
      if (isPlatform) {
        bondingCurveBalance = balance;
      }

      // Determine label
      let label: string | undefined;
      if (isPlatform) {
        label = 'Bonding Curve';
      } else if (isCreator) {
        label = 'Creator (dev)';
      }

      holders.push({
        address: owner || account.address.toBase58(),
        balance,
        percentage,
        label,
      });
    }

    // Sort by balance descending
    holders.sort((a, b) => b.balance - a.balance);

    // Calculate circulating supply (total - bonding curve)
    const circulatingSupply = totalSupply - bondingCurveBalance;

    return NextResponse.json({
      success: true,
      mint,
      holders: holders.slice(0, 10), // Top 10
      totalSupply,
      circulatingSupply,
      bondingCurveBalance,
    });

  } catch (error) {
    console.error('Error fetching holders:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch holders' },
      { status: 500 }
    );
  }
}
