import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Rate limiting - simple in-memory store (use Redis in production)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 100; // requests per minute
const RATE_WINDOW = 60 * 1000; // 1 minute in ms

// Allowed RPC methods (whitelist for security)
const ALLOWED_METHODS = [
  'getBalance',
  'getTokenBalance',
  'getTokenAccountsByOwner',
  'getAccountInfo',
  'getTokenAccountBalance',
  'getTokenLargestAccounts',
  'getTokenSupply',
  'getLatestBlockhash',
  'getFeeCalculatorForBlockhash',
  'getSlot',
  'getBlockHeight',
  'getTransaction',
  'getSignatureStatuses',
  'sendTransaction',
  'simulateTransaction',
  'getMinimumBalanceForRentExemption',
  'getProgramAccounts',
  'getMultipleAccounts',
  'getBlockTime',
  'getInflationReward',
  'getEpochInfo',
  'getVoteAccounts',
  'getIdentity',
  'getVersion',
  'getHealth',
  'getGenesisHash',
  'getFirstAvailableBlock',
  'getBlocks',
  'getBlock',
  'getBlockCommitment',
  'getBlockProduction',
  'getClusters',
  'getEpochSchedule',
  'getFeeRateGovernor',
  'getFees',
  'getInflationGovernor',
  'getInflationRate',
  'getLargestAccounts',
  'getLeaderSchedule',
  'getRecentPerformanceSamples',
  'getHighestSnapshotSlot',
  'getSupply',
  'getTokenSupply',
  'getTransactionCount',
];

/**
 * Simple rate limiter
 */
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  
  if (!record || now > record.resetTime) {
    // New window
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
    return true;
  }
  
  if (record.count >= RATE_LIMIT) {
    return false;
  }
  
  record.count++;
  return true;
}

/**
 * Validate and sanitize RPC request
 */
function validateRequest(body: any): { valid: boolean; error?: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Invalid request body' };
  }
  
  // Handle batch requests
  if (Array.isArray(body)) {
    if (body.length > 10) {
      return { valid: false, error: 'Batch size too large (max 10)' };
    }
    for (const req of body) {
      const result = validateSingleRequest(req);
      if (!result.valid) return result;
    }
    return { valid: true };
  }
  
  return validateSingleRequest(body);
}

function validateSingleRequest(body: any): { valid: boolean; error?: string } {
  if (!body.jsonrpc || body.jsonrpc !== '2.0') {
    return { valid: false, error: 'Invalid jsonrpc version' };
  }
  
  if (!body.method || typeof body.method !== 'string') {
    return { valid: false, error: 'Missing or invalid method' };
  }
  
  if (!ALLOWED_METHODS.includes(body.method)) {
    return { valid: false, error: `Method not allowed: ${body.method}` };
  }
  
  return { valid: true };
}

/**
 * RPC Proxy Endpoint
 * Forwards requests to Helius with API key (server-side only)
 */
export async function POST(request: NextRequest) {
  try {
    // Get client IP for rate limiting
    const ip = request.headers.get('x-forwarded-for') || 
               request.headers.get('x-real-ip') || 
               'unknown';
    
    // Check rate limit
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { jsonrpc: '2.0', error: { code: 429, message: 'Rate limit exceeded' }, id: null },
        { status: 429 }
      );
    }
    
    // Parse request body
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null },
        { status: 400 }
      );
    }
    
    // Validate request
    const validation = validateRequest(body);
    if (!validation.valid) {
      return NextResponse.json(
        { jsonrpc: '2.0', error: { code: -32600, message: validation.error }, id: body.id || null },
        { status: 400 }
      );
    }
    
    // Get RPC URL from server-side env var (NEVER expose this to client)
    const rpcUrl = process.env.SOLANA_RPC_URL;
    
    if (!rpcUrl) {
      console.error('[RPC Proxy] SOLANA_RPC_URL not configured');
      return NextResponse.json(
        { jsonrpc: '2.0', error: { code: -32603, message: 'RPC provider not configured' }, id: body.id || null },
        { status: 500 }
      );
    }
    
    // Forward request to RPC provider
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
    
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[RPC Proxy] Helius error: ${response.status}`, errorText);
        return NextResponse.json(
          { jsonrpc: '2.0', error: { code: -32603, message: 'Upstream error' }, id: body.id || null },
          { status: 502 }
        );
      }
      
      // Return Helius response
      const data = await response.json();
      return NextResponse.json(data);
      
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        return NextResponse.json(
          { jsonrpc: '2.0', error: { code: -32603, message: 'Request timeout' }, id: body.id || null },
          { status: 504 }
        );
      }
      
      throw error;
    }
    
  } catch (error) {
    console.error('[RPC Proxy] Error:', error);
    return NextResponse.json(
      { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null },
      { status: 500 }
    );
  }
}

/**
 * GET handler for health checks
 */
export async function GET() {
  return NextResponse.json({ 
    status: 'ok',
    message: 'RPC Proxy is running. Use POST for RPC requests.'
  });
}
