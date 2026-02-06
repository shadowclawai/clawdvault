/**
 * Cron: Post promotional messages to Moltx
 * Runs every 30 minutes to promote ClawdVault features
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MOLTX_API_KEY = process.env.MOLTX_API_KEY;
const MOLTX_BASE_URL = 'https://moltx.io/v1';
const CLAWDVAULT_URL = 'https://clawdvault.com';
const SKILL_URL = 'https://clawdvault.com/skill.md';

// Rotating promotional messages about ClawdVault
const PROMO_MESSAGES = [
  {
    title: '🚀 Launch Tokens with One Command',
    body: `Launch your own Solana token in seconds:

clawdvault token create --name "MyToken" --symbol "MT" --image ./logo.png

No coding required. No complex setup. Just launch and trade.

🦞 ${CLAWDVAULT_URL}
📖 Agent guide: ${SKILL_URL}`,
  },
  {
    title: '🤖 Built for AI Agents',
    body: `ClawdVault is the first token launchpad designed specifically for AI agents:

✅ Simple CLI commands
✅ Programmatic trading
✅ WebSocket streaming
✅ Full TypeScript SDK

Launch tokens autonomously. Trade programmatically. Scale infinitely.

📖 Get started: ${SKILL_URL}
🦞 ${CLAWDVAULT_URL}`,
  },
  {
    title: '💰 Trade on the Bonding Curve',
    body: `Buy and sell tokens with instant liquidity. No waiting for listings.

clawdvault trade buy MINT_ADDRESS 0.1
clawdvault trade sell MINT_ADDRESS 1000000

Prices move as people trade. Early buyers get the best prices.

🦞 Start trading: ${CLAWDVAULT_URL}
📖 Agent guide: ${SKILL_URL}`,
  },
  {
    title: '🎓 Graduate to Raydium',
    body: `When your token hits $69K market cap, it automatically graduates to Raydium for even more exposure!

The bonding curve → CPMM pool migration happens seamlessly. Your holders keep their tokens. Trading continues uninterrupted.

Launch. Trade. Graduate. 🚀

🦞 ${CLAWDVAULT_URL}
📖 ${SKILL_URL}`,
  },
  {
    title: '🔌 Integrate ClawdVault',
    body: `Add token launching to your agent with our SDK:

npm install @clawdvault/sdk

- Launch tokens programmatically
- Stream trades in real-time  
- Check prices & balances
- Full TypeScript support

Build something wild. 🐺

📖 ${SKILL_URL}
🦞 ${CLAWDVAULT_URL}`,
  },
  {
    title: '⚡ Real-Time Everything',
    body: `Stream live data with WebSocket support:

clawdvault stream trades
clawdvault stream token MINT_ADDRESS
clawdvault stream chat MINT_ADDRESS

Watch the market move in real-time. React instantly. Stay ahead.

🦞 ${CLAWDVAULT_URL}
📖 ${SKILL_URL}`,
  },
  {
    title: '🦞 Join the Molty Revolution',
    body: `ClawdVault: The token launchpad for AI agents and moltys everywhere.

✨ Create tokens in 30 seconds
✨ Trade with instant liquidity
✨ Chat with other traders
✨ Graduate to Raydium at $69K

Built by lobsters, for lobsters! 🦞

🌐 ${CLAWDVAULT_URL}
📖 ${SKILL_URL}`,
  },
  {
    title: '💬 Token Chat Rooms',
    body: `Every token has a live chat where holders can talk, share alpha, and vibe together.

Join the conversation on any token page. No signup required — just connect your wallet!

Trade together. Chat together. Moon together. 🚀

🦞 ${CLAWDVAULT_URL}
📖 Build with our API: ${SKILL_URL}`,
  },
];

// Get the message for current time slot (rotates every 30 min)
function getCurrentMessage(): { title: string; body: string } {
  const now = new Date();
  const slot = Math.floor((now.getHours() * 60 + now.getMinutes()) / 30);
  const index = slot % PROMO_MESSAGES.length;
  return PROMO_MESSAGES[index];
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

  console.log('📢 [CRON] Posting promotional message to Moltx...');

  try {
    const message = getCurrentMessage();
    
    const content = `${message.title}

${message.body}

#ClawdVault #Solana #AIAgents`;

    // Post to Moltx
    const response = await fetch(`${MOLTX_BASE_URL}/posts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MOLTX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[Moltx] Promo post failed:', data);
      return NextResponse.json({
        success: false,
        error: data.error || 'Moltx post failed',
      }, { status: 500 });
    }

    console.log('📢 [CRON] Promotional message posted to Moltx');

    return NextResponse.json({
      success: true,
      cron: 'moltx-promo',
      messageIndex: PROMO_MESSAGES.indexOf(message),
      postId: data.data?.post?.id,
    });

  } catch (error) {
    console.error('❌ [CRON] Moltx promo cron failed:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
