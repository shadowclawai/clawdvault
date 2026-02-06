import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { findBondingCurvePDA } from '@/lib/anchor/client';

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

  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const mintPubkey = new PublicKey(mint);
    
    // Find bonding curve PDA and its token vault
    const [bondingCurvePDA] = findBondingCurvePDA(mintPubkey);
    const bondingCurveVault = await getAssociatedTokenAddress(mintPubkey, bondingCurvePDA, true);
    const bondingCurveOwner = bondingCurvePDA.toBase58();

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
      
      // Check if this is the bonding curve vault or creator
      const isBondingCurve = owner === bondingCurveOwner;
      const isCreator = creator && owner === creator;
      
      if (isBondingCurve) {
        bondingCurveBalance = balance;
      }

      // Determine label
      let label: string | undefined;
      if (isBondingCurve) {
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
    // Return empty holders on RPC error (rate limiting, etc)
    // Frontend will use client-side RPC as fallback
    return NextResponse.json({
      success: true,
      mint,
      holders: [],
      totalSupply: 1_000_000_000,
      circulatingSupply: 0,
      rpcError: true,
    });
  }
}
