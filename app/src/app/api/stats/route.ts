import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import ClawdVaultClient, { findBondingCurvePDA, findSolVaultPDA } from '@/lib/anchor/client';

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

  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const mintPubkey = new PublicKey(mint);
    const client = new ClawdVaultClient(connection);
    
    // Get bonding curve state from on-chain
    const curveState = await client.getBondingCurve(mintPubkey);
    
    if (!curveState) {
      // Fallback for tokens not on Anchor program
      return NextResponse.json({
        success: true,
        mint,
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

    // Get total supply
    const supplyInfo = await connection.getTokenSupply(mintPubkey);
    const totalSupply = Number(supplyInfo.value.uiAmount) || 1_000_000_000;

    // Get SOL vault balance
    const [solVaultPDA] = findSolVaultPDA(mintPubkey);
    const solVaultBalance = await connection.getBalance(solVaultPDA);
    const bondingCurveSol = solVaultBalance / LAMPORTS_PER_SOL;

    // Use actual on-chain reserves for accurate pricing
    const virtualSolReserves = Number(curveState.virtualSolReserves) / LAMPORTS_PER_SOL;
    const virtualTokenReserves = Number(curveState.virtualTokenReserves) / 1_000_000; // 6 decimals
    const realTokenReserves = Number(curveState.realTokenReserves) / 1_000_000;
    
    // Calculate price from actual reserves
    const price = virtualSolReserves / virtualTokenReserves;
    const circulatingSupply = totalSupply - realTokenReserves;
    const marketCap = price * totalSupply;

    return NextResponse.json({
      success: true,
      mint,
      onChain: {
        totalSupply,
        bondingCurveBalance: realTokenReserves,
        circulatingSupply,
        bondingCurveSol,
        virtualSolReserves,
        virtualTokenReserves,
        price,
        marketCap,
        graduated: curveState.graduated,
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
