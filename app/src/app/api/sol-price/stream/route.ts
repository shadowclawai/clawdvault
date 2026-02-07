/**
 * Server-Sent Events (SSE) endpoint for SOL price streaming
 * Alternative to Supabase Realtime for clients that prefer SSE
 * 
 * Usage:
 * ```javascript
 * const evtSource = new EventSource('/api/sol-price/stream');
 * evtSource.onmessage = (e) => {
 *   const data = JSON.parse(e.data);
 *   console.log('SOL Price:', data.price);
 * };
 * ```
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Revalidate interval (1 minute = 60000ms)
const UPDATE_INTERVAL = 60000;

export async function GET(request: Request) {
  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      // Send initial price
      sendPrice(controller);
      
      // Set up interval for updates
      const interval = setInterval(() => {
        sendPrice(controller);
      }, UPDATE_INTERVAL);
      
      // Clean up on close
      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });
  
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

async function sendPrice(controller: ReadableStreamDefaultController) {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/sol-price`);
    
    if (!res.ok) {
      throw new Error(`Failed to fetch price: ${res.status}`);
    }
    
    const data = await res.json();
    
    const message = {
      price: data.price,
      source: data.source,
      updatedAt: data.updatedAt,
      age: data.age,
      valid: data.valid,
      timestamp: Date.now(),
    };
    
    controller.enqueue(
      new TextEncoder().encode(`data: ${JSON.stringify(message)}\n\n`)
    );
  } catch (err) {
    console.error('[SSE] Failed to fetch price:', err);
    controller.enqueue(
      new TextEncoder().encode(`data: ${JSON.stringify({ error: 'Failed to fetch price' })}\n\n`)
    );
  }
}
