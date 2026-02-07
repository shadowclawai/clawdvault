import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/prisma';
import { extractAuth, verifyWalletAuth } from '@/lib/auth';
import { jwtVerify } from 'jose';

// JWT secret for session verification
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'clawdvault-session-secret-change-in-production'
);

// Verify session token and return wallet
async function verifySession(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  
  try {
    const token = authHeader.slice(7);
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload.wallet as string || null;
  } catch {
    return null;
  }
}

// GET /api/chat?mint=xxx - Get chat messages for a token
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const mint = searchParams.get('mint');
    const limit = parseInt(searchParams.get('limit') || '50');
    const before = searchParams.get('before'); // cursor for pagination

    if (!mint) {
      return NextResponse.json(
        { success: false, error: 'Missing mint parameter' },
        { status: 400 }
      );
    }

    const messages = await db().chatMessage.findMany({
      where: {
        tokenMint: mint,
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        reactions: true,
      },
    });

    // Get unique sender wallets to fetch profiles
    const senderWallets = Array.from(new Set(messages.map(m => m.sender)));
    
    // Fetch all profiles in one query
    const profiles = await db().userProfile.findMany({
      where: { wallet: { in: senderWallets } },
    });
    
    // Create wallet -> profile map
    const profileMap = new Map(profiles.map(p => [p.wallet, p]));

    // Enrich messages with profile data and aggregate reactions
    const enrichedMessages = messages.map(msg => {
      // Aggregate reactions by emoji
      const reactionCounts: Record<string, { count: number; wallets: string[] }> = {};
      for (const reaction of msg.reactions) {
        if (!reactionCounts[reaction.emoji]) {
          reactionCounts[reaction.emoji] = { count: 0, wallets: [] };
        }
        reactionCounts[reaction.emoji].count++;
        reactionCounts[reaction.emoji].wallets.push(reaction.wallet);
      }

      return {
        id: msg.id,
        sender: msg.sender,
        username: profileMap.get(msg.sender)?.username || null,
        avatar: profileMap.get(msg.sender)?.avatar || null,
        message: msg.message,
        replyTo: msg.replyTo,
        createdAt: msg.createdAt.toISOString(),
        reactions: reactionCounts,
      };
    });

    // Return in reverse chronological order (newest first) for bottom-up chat display
    return NextResponse.json({
      success: true,
      messages: enrichedMessages,
      hasMore: messages.length === limit,
    });
  } catch (error) {
    console.error('Error fetching chat:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch chat messages' },
      { status: 500 }
    );
  }
}

// POST /api/chat - Send a chat message
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mint, message, replyTo } = body;

    if (!mint || !message) {
      return NextResponse.json(
        { success: false, error: 'Missing mint or message' },
        { status: 400 }
      );
    }

    // Try session token first (Bearer token in Authorization header)
    let sender = await verifySession(request);
    
    // Fall back to per-message signature auth
    if (!sender) {
      const auth = extractAuth(request);
      if (!auth) {
        return NextResponse.json(
          { success: false, error: 'Authentication required (session token or signature)' },
          { status: 401 }
        );
      }

      // Verify signature - the signed data includes mint and message
      const signedData = { mint, message: message.trim(), replyTo: replyTo || null };
      if (!verifyWalletAuth(auth.wallet, auth.signature, 'chat', signedData)) {
        return NextResponse.json(
          { success: false, error: 'Invalid signature' },
          { status: 401 }
        );
      }
      sender = auth.wallet;
    }

    // Validate message length
    if (message.length > 500) {
      return NextResponse.json(
        { success: false, error: 'Message too long (max 500 chars)' },
        { status: 400 }
      );
    }

    // Check if token exists
    const token = await db().token.findUnique({
      where: { mint },
    });

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Token not found' },
        { status: 404 }
      );
    }

    // Create message and update profile stats in transaction
    const [chatMessage, profile] = await db().$transaction(async (tx) => {
      const msg = await tx.chatMessage.create({
        data: {
          tokenMint: mint,
          sender,
          message: message.trim(),
          replyTo: replyTo || null,
        },
      });

      // Ensure profile exists and increment message count
      const prof = await tx.userProfile.upsert({
        where: { wallet: sender },
        create: { wallet: sender, messageCount: 1 },
        update: { messageCount: { increment: 1 } },
      });

      return [msg, prof];
    });

    return NextResponse.json({
      success: true,
      message: {
        id: chatMessage.id,
        sender: chatMessage.sender,
        username: profile.username,
        avatar: profile.avatar,
        message: chatMessage.message,
        replyTo: chatMessage.replyTo,
        createdAt: chatMessage.createdAt.toISOString(),
        reactions: {},
      },
    });
  } catch (error) {
    console.error('Error posting chat message:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to post message' },
      { status: 500 }
    );
  }
}
