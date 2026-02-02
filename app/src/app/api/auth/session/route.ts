import { NextRequest, NextResponse } from 'next/server';
import { verifyWalletAuth, extractAuth } from '@/lib/auth';
import { SignJWT, jwtVerify } from 'jose';

export const dynamic = 'force-dynamic';

// Secret for JWT signing (in production, use env var)
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'clawdvault-session-secret-change-in-production'
);

const SESSION_DURATION = 24 * 60 * 60; // 24 hours in seconds

/**
 * Create a new session token
 * POST /api/auth/session
 * 
 * Requires wallet signature to prove ownership.
 * Returns a JWT that can be used for chat/reactions without re-signing.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = extractAuth(request);
    
    if (!auth.wallet || !auth.signature) {
      return NextResponse.json(
        { success: false, error: 'Wallet signature required' },
        { status: 401 }
      );
    }

    // Verify the signature - signed data should be { action: 'create_session' }
    const signedData = { action: 'create_session' };
    if (!verifyWalletAuth(auth.wallet, auth.signature, 'session', signedData)) {
      return NextResponse.json(
        { success: false, error: 'Invalid signature' },
        { status: 401 }
      );
    }

    // Create JWT session token
    const token = await new SignJWT({ 
      wallet: auth.wallet,
      type: 'chat_session'
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${SESSION_DURATION}s`)
      .sign(JWT_SECRET);

    return NextResponse.json({
      success: true,
      token,
      expiresIn: SESSION_DURATION,
      wallet: auth.wallet,
    });

  } catch (error) {
    console.error('Error creating session:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create session' },
      { status: 500 }
    );
  }
}

/**
 * Verify a session token
 * GET /api/auth/session
 * 
 * Pass token in Authorization header: Bearer <token>
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'No token provided' },
        { status: 401 }
      );
    }

    const token = authHeader.slice(7);
    
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);
      
      return NextResponse.json({
        success: true,
        valid: true,
        wallet: payload.wallet,
        expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
      });
    } catch {
      return NextResponse.json({
        success: true,
        valid: false,
        error: 'Token expired or invalid',
      });
    }

  } catch (error) {
    console.error('Error verifying session:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to verify session' },
      { status: 500 }
    );
  }
}

/**
 * Helper to verify session token (used by other API routes)
 */
export async function verifySessionToken(token: string): Promise<{ valid: boolean; wallet?: string }> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return { valid: true, wallet: payload.wallet as string };
  } catch {
    return { valid: false };
  }
}
