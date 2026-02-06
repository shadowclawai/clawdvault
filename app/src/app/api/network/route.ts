import { NextResponse } from 'next/server';
import { getNetworkStatus, getConnection } from '@/lib/solana';
import { findConfigPDA, PROGRAM_ID } from '@/lib/anchor';

export const dynamic = 'force-dynamic';

/**
 * Check if the Anchor program is deployed by looking for the config PDA
 */
async function checkAnchorProgram(): Promise<boolean> {
  try {
    const connection = getConnection();
    const [configPDA] = findConfigPDA();
    const account = await connection.getAccountInfo(configPDA);
    return account !== null;
  } catch {
    return false;
  }
}

export async function GET() {
  try {
    const status = await getNetworkStatus();
    const anchorProgram = await checkAnchorProgram();
    
    // Don't expose full RPC URL (contains API key)
    const rpcProvider = 
      process.env.SOLANA_RPC_URL?.includes('helius') ? 'helius' :
      process.env.SOLANA_RPC_URL?.includes('quicknode') ? 'quicknode' :
      'default';
    
    return NextResponse.json({
      success: true,
      ...status,
      rpcProvider,
      anchorProgram,
      programId: PROGRAM_ID.toBase58(),
    });
  } catch (error) {
    console.error('Error getting network status:', error);
    return NextResponse.json({
      success: true,
      network: process.env.SOLANA_NETWORK || 'devnet',
      anchorProgram: false,
      error: 'Failed to connect to Solana network',
    });
  }
}
