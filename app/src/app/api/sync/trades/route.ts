import { NextResponse } from 'next/server';
import { syncTrades } from '@/lib/sync-trades';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sync/trades
 * Sync recent on-chain trades to database
 * 
 * Query params:
 * - limit: max transactions to check (default 100)
 * - mint: specific token mint to sync (optional)
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);
  const mintFilter = searchParams.get('mint');
  
  const result = await syncTrades({ limit, mintFilter });
  
  if (!result.success) {
    return NextResponse.json(result, { status: 500 });
  }
  
  return NextResponse.json(result);
}

/**
 * POST /api/sync/trades
 * Force sync all trades for a specific token
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { mint } = body;
    
    if (!mint) {
      return NextResponse.json(
        { success: false, error: 'mint is required' },
        { status: 400 }
      );
    }
    
    const result = await syncTrades({ limit: 500, mintFilter: mint });
    
    if (!result.success) {
      return NextResponse.json(result, { status: 500 });
    }
    
    return NextResponse.json(result);
    
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Invalid request' },
      { status: 400 }
    );
  }
}
