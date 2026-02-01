import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { isMockMode, getPlatformWalletPubkey } from '@/lib/solana';

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

export const dynamic = 'force-dynamic';

// GET /api/stats?mint=xxx - Get on-chain stats for a token
export async function GET(request: NextRequest) {
  const mint = request.nextUrl.searchParams.get('mint');
  
  if (!mint) {
    return NextResponse.json(
      { success: false, error: 'Missing mint parameter' },
      { status: 400 }
    );
  }

  // Mock mode: return defaults
  if (isMockMode()) {
    return NextResponse.json({
      success: true,
      mint,
      mockMode: true,
      onChain: {
        totalSupply: 1_000_000_000,
        bondingCurveBalance: 1_000_000_000,
        circulatingSupply: 0,
        bondingCurveSol: 0,
        price: 0.000000028,
        marketCap: 30,
      }
    });
  }

  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const mintPubkey = new PublicKey(mint);
    const platformWallet = getPlatformWalletPubkey();
    
    if (!platformWallet) {
      throw new Error('Platform wallet not configured');
    }

    const platformPubkey = new PublicKey(platformWallet);

    // Get total supply
    const supplyInfo = await connection.getTokenSupply(mintPubkey);
    const totalSupply = Number(supplyInfo.value.uiAmount) || 1_000_000_000;

    // Get platform's token balance (bonding curve)
    const platformATA = await getAssociatedTokenAddress(mintPubkey, platformPubkey);
    let bondingCurveBalance = 0;
    
    try {
      const balance = await connection.getTokenAccountBalance(platformATA);
      bondingCurveBalance = Number(balance.value.uiAmount) || 0;
    } catch (e) {
      // Account doesn't exist
    }

    // Get platform's SOL balance (liquidity)
    const platformSolBalance = await connection.getBalance(platformPubkey);
    const bondingCurveSol = platformSolBalance / LAMPORTS_PER_SOL;

    // Calculate circulating supply
    const circulatingSupply = totalSupply - bondingCurveBalance;

    // Calculate price from bonding curve
    // Using constant product formula: price = virtual_sol / virtual_tokens
    // For on-chain accuracy, we estimate based on reserves
    const INITIAL_VIRTUAL_SOL = 30;
    const INITIAL_VIRTUAL_TOKENS = 1_073_000_000;
    
    // Tokens sold = initial bonding allocation - current bonding balance
    // But we don't know initial allocation per-token, so use circulating as proxy
    const tokensSold = circulatingSupply;
    
    // Estimate virtual reserves (simplified)
    // In reality, we'd need to track this in a program
    const estimatedVirtualSol = INITIAL_VIRTUAL_SOL + (tokensSold * INITIAL_VIRTUAL_SOL / INITIAL_VIRTUAL_TOKENS);
    const estimatedVirtualTokens = INITIAL_VIRTUAL_TOKENS - tokensSold;
    
    const price = estimatedVirtualSol / Math.max(estimatedVirtualTokens, 1);
    const marketCap = price * totalSupply;

    return NextResponse.json({
      success: true,
      mint,
      onChain: {
        totalSupply,
        bondingCurveBalance,
        circulatingSupply,
        bondingCurveSol,
        price,
        marketCap,
      }
    });

  } catch (error) {
    console.error('Error fetching on-chain stats:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch on-chain stats' },
      { status: 500 }
    );
  }
}
