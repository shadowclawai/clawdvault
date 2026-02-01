import { NextResponse } from 'next/server';
import { getNetworkStatus, isMockMode, getConnection } from '@/lib/solana';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const status = await getNetworkStatus();
    
    return NextResponse.json({
      success: true,
      ...status,
      rpcUrl: isMockMode() ? 'mock' : process.env.SOLANA_RPC_URL || 'default',
    });
  } catch (error) {
    console.error('Error getting network status:', error);
    return NextResponse.json({
      success: true,
      network: process.env.SOLANA_NETWORK || 'devnet',
      mockMode: isMockMode(),
      error: 'Failed to connect to Solana network',
    });
  }
}
