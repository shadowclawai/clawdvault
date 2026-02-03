/**
 * Cron: Sync on-chain trades
 * Runs every minute to catch any missed trades
 * 
 * Vercel Cron calls this with CRON_SECRET header
 */

import { NextResponse } from 'next/server';
import { syncTrades } from '@/lib/sync-trades';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow up to 60s for sync

export async function GET(request: Request) {
  // Verify cron secret (Vercel sends this automatically)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.warn('⚠️ Unauthorized cron attempt');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('🔄 [CRON] Starting trade sync...');
  
  try {
    // Call sync logic directly (no HTTP request needed)
    const result = await syncTrades({ limit: 200 });
    
    console.log(`🔄 [CRON] Sync complete: ${result.synced} new trades`);
    
    return NextResponse.json({
      cron: 'sync-trades',
      ...result,
    });
    
  } catch (error) {
    console.error('❌ [CRON] Sync failed:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
