import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/prisma';

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
    });

    // Return in chronological order (oldest first)
    return NextResponse.json({
      success: true,
      messages: messages.reverse(),
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
    const { mint, sender, senderName, message, replyTo } = body;

    if (!mint || !message) {
      return NextResponse.json(
        { success: false, error: 'Missing mint or message' },
        { status: 400 }
      );
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

    // Create message
    const chatMessage = await db().chatMessage.create({
      data: {
        tokenMint: mint,
        sender: sender || 'anonymous',
        senderName: senderName || null,
        message: message.trim(),
        replyTo: replyTo || null,
      },
    });

    return NextResponse.json({
      success: true,
      message: chatMessage,
    });
  } catch (error) {
    console.error('Error posting chat message:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to post message' },
      { status: 500 }
    );
  }
}
