/**
 * Cron: Post top token prices to Moltx
 * Runs every 30 minutes
 */

import { NextResponse } from 'next/server';
import { getAllTokens } from '@/lib/db';
import { postToMoltx } from '@/lib/moltx-evm';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MOLTX_API_KEY = process.env.MOLTX_API_KEY;
const MOLTX_EVM_PRIVATE_KEY = process.env.MOLTX_EVM_PRIVATE_KEY;
const MOLTX_EVM_ADDRESS = process.env.MOLTX_EVM_ADDRESS;
const CLAWDVAULT_URL = 'https://clawdvault.com';
const TOP_N = 5; // Number of tokens to feature

// Format SOL amount (handles very small prices like 0.00000003)
function formatSol(amount: number): string {
  if (amount >= 1) return amount.toFixed(2);
  if (amount >= 0.1) return amount.toFixed(3);
  if (amount >= 0.0001) return amount.toFixed(4);
  if (amount >= 0.0000001) return amount.toFixed(8);
  // For extremely small numbers, use scientific notation
  return amount.toExponential(2);
}

// Format market cap in SOL
function formatMcap(mcap: number): string {
  if (mcap >= 1000) return (mcap / 1000).toFixed(1) + 'K';
  return mcap.toFixed(1);
}

// Format USD amount
function formatUsd(amount: number): string {
  if (amount >= 1000000) return '$' + (amount / 1000000).toFixed(2) + 'M';
  if (amount >= 1000) return '$' + (amount / 1000).toFixed(1) + 'K';
  if (amount >= 1) return '$' + amount.toFixed(0);
  return '$' + amount.toFixed(2);
}

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.warn('⚠️ Unauthorized cron attempt');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!MOLTX_API_KEY) {
    return NextResponse.json({ 
      success: false, 
      error: 'MOLTX_API_KEY not configured' 
    }, { status: 500 });
  }

  if (!MOLTX_EVM_PRIVATE_KEY || !MOLTX_EVM_ADDRESS) {
    return NextResponse.json({ 
      success: false, 
      error: 'MOLTX_EVM_PRIVATE_KEY and MOLTX_EVM_ADDRESS not configured' 
    }, { status: 500 });
  }

  console.log('📊 [CRON] Posting top token prices to Moltx...');

  try {
    // Get top tokens by market cap (non-graduated)
    const { tokens } = await getAllTokens({ 
      sort: 'market_cap', 
      graduated: false,
      perPage: TOP_N 
    });

    if (tokens.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No active tokens to report',
      });
    }

    // Build the price update post using USD values directly from database
    let content = `📊 ClawdVault Top ${tokens.length} Tokens\n\n`;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const rank = i + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
      
      // Use market_cap_usd directly from database (calculated from candles)
      const mcapUsd = token.market_cap_usd ? ` (${formatUsd(token.market_cap_usd)})` : '';
      
      content += `${medal} $${token.symbol}\n`;
      content += `   🏦 MCap: ${formatMcap(token.market_cap_sol)} SOL${mcapUsd}\n`;
    }

    content += `\n🦞 Trade now: ${CLAWDVAULT_URL}\n`;
    content += `🤖 Agent API: ${CLAWDVAULT_URL}/skill.md\n`;
    content += `\n#ClawdVault #Solana`;

    // Post to Moltx with EVM signing
    const result = await postToMoltx(
      {
        apiKey: MOLTX_API_KEY,
        privateKey: MOLTX_EVM_PRIVATE_KEY,
        address: MOLTX_EVM_ADDRESS,
      },
      content
    );

    if (!result.success) {
      console.error('[Moltx] Price post failed:', result.error);
      return NextResponse.json({
        success: false,
        error: result.error || 'Moltx post failed',
      }, { status: 500 });
    }

    console.log('📊 [CRON] Price update posted to Moltx');

    return NextResponse.json({
      success: true,
      cron: 'moltx-prices',
      tokensReported: tokens.length,
      postId: result.postId,
    });

  } catch (error) {
    console.error('❌ [CRON] Moltx prices cron failed:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
