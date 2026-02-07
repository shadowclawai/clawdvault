'use client';

import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

// Client-side Supabase client for realtime subscriptions
let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    console.log('[Supabase] Initializing client with URL:', url);
    
    if (!url || !key) {
      throw new Error('Supabase URL and Anon Key are required');
    }
    
    supabaseClient = createClient(url, key, {
      realtime: {
        params: {
          eventsPerSecond: 10
        }
      }
    });
  }
  return supabaseClient;
}

// Types for realtime payloads
export interface RealtimeMessage {
  id: string;
  token_mint: string;
  sender: string;
  message: string;
  reply_to: string | null;
  created_at: string;
}

export interface RealtimeTrade {
  id: string;
  token_mint: string;
  trader: string;
  trade_type: 'buy' | 'sell';
  sol_amount: number;
  token_amount: number;
  price_sol: number;
  signature: string | null;
  created_at: string;
}

// Subscribe to chat messages for a specific token
export function subscribeToChatMessages(
  mint: string,
  onInsert: (message: RealtimeMessage) => void,
  onDelete?: (id: string) => void
): RealtimeChannel {
  const client = getSupabaseClient();
  
  console.log('[Realtime] Subscribing to chat for:', mint);
  
  // Subscribe without filter - filter client-side (more reliable with hosted Supabase)
  const channel = client
    .channel(`chat:${mint}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
      },
      (payload) => {
        const msg = payload.new as RealtimeMessage;
        if (msg?.token_mint === mint) {
          console.log('[Realtime] Chat message received:', msg.id);
          onInsert(msg);
        }
      }
    );
  
  if (onDelete) {
    channel.on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'chat_messages',
      },
      (payload) => {
        const old = payload.old as any;
        if (old?.token_mint === mint) {
          console.log('[Realtime] Chat message deleted:', old.id);
          onDelete(old.id);
        }
      }
    );
  }
  
  channel.subscribe((status) => {
    console.log('[Realtime] Chat subscription status:', status);
  });
  return channel;
}

// Subscribe to trades for a specific token
export function subscribeToTrades(
  mint: string,
  onInsert: (trade: RealtimeTrade) => void
): RealtimeChannel {
  const client = getSupabaseClient();
  
  console.log('[Realtime] Subscribing to trades for:', mint);
  
  // Subscribe without filter - filter client-side (more reliable with hosted Supabase)
  const channel = client
    .channel(`trades:${mint}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'trades',
      },
      (payload) => {
        const trade = payload.new as RealtimeTrade;
        if (trade?.token_mint === mint) {
          console.log('[Realtime] Trade received:', trade.id);
          onInsert(trade);
        }
      }
    )
    .subscribe((status) => {
      console.log('[Realtime] Trades subscription status:', status);
    });
  
  return channel;
}

// Subscribe to reactions for a token's messages
export function subscribeToReactions(
  mint: string,
  onChange: () => void
): RealtimeChannel {
  const client = getSupabaseClient();
  
  console.log('[Realtime] Subscribing to reactions for:', mint);
  
  // Subscribe to both inserts and deletes on reactions
  const channel = client
    .channel(`reactions:${mint}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'message_reactions'
      },
      (payload) => {
        console.log('[Realtime] Reaction change:', payload.eventType);
        // Trigger refetch of messages to get updated reaction counts
        onChange();
      }
    )
    .subscribe((status) => {
      console.log('[Realtime] Reactions subscription status:', status);
    });
  
  return channel;
}

// Subscribe to token stats updates (reserves, price changes)
export function subscribeToTokenStats(
  mint: string,
  onUpdate: (token: any) => void
): RealtimeChannel {
  const client = getSupabaseClient();
  
  console.log('[Realtime] Subscribing to token stats for:', mint);
  
  // Subscribe without filter - filter in callback instead (more reliable with local Supabase)
  const channel = client
    .channel(`token:${mint}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'tokens',
      },
      (payload) => {
        const record = payload.new as any;
        if (record?.mint === mint) {
          console.log('[Realtime] Token update received:', payload);
          onUpdate(record);
        }
      }
    )
    .subscribe((status) => {
      console.log('[Realtime] Subscription status:', status);
    });
  
  return channel;
}

// Unsubscribe from a channel
export function unsubscribeChannel(channel: RealtimeChannel): void {
  const client = getSupabaseClient();
  client.removeChannel(channel);
}

// Subscribe to all token changes (for browse/home pages)
export function subscribeToAllTokens(
  onInsert: (token: any) => void,
  onUpdate: (token: any) => void
): RealtimeChannel {
  const client = getSupabaseClient();
  
  console.log('[Realtime] Subscribing to all tokens');
  
  const channel = client
    .channel('all-tokens')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'tokens'
      },
      (payload) => {
        console.log('[Realtime] New token created:', payload.new);
        onInsert(payload.new);
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'tokens'
      },
      (payload) => {
        console.log('[Realtime] Token updated:', payload.new);
        onUpdate(payload.new);
      }
    )
    .subscribe((status) => {
      console.log('[Realtime] All tokens subscription status:', status);
    });
  
  return channel;
}

// Subscribe to all trades (for volume updates)
export function subscribeToAllTrades(
  onInsert: (trade: any) => void
): RealtimeChannel {
  const client = getSupabaseClient();
  
  console.log('[Realtime] Subscribing to all trades');
  
  const channel = client
    .channel('all-trades')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'trades'
      },
      (payload) => {
        console.log('[Realtime] New trade:', payload.new);
        onInsert(payload.new);
      }
    )
    .subscribe((status) => {
      console.log('[Realtime] All trades subscription status:', status);
    });
  
  return channel;
}

// Subscribe to candle updates for a specific token
export function subscribeToCandles(
  mint: string,
  onUpdate: () => void
): RealtimeChannel {
  const client = getSupabaseClient();

  console.log('[Realtime] Subscribing to candles for:', mint);

  // Subscribe without filter - filter in callback instead (more reliable with local Supabase)
  const channel = client
    .channel(`candles:${mint}`)
    .on(
      'postgres_changes',
      {
        event: '*', // INSERT or UPDATE
        schema: 'public',
        table: 'price_candles',
      },
      (payload) => {
        // Filter client-side
        const record = payload.new as any;
        if (record?.token_mint === mint) {
          console.log('[Realtime] Candle update for this token:', payload);
          onUpdate();
        }
      }
    )
    .subscribe((status) => {
      console.log('[Realtime] Candles subscription status:', status);
    });

  return channel;
}

// SOL Price type for realtime updates
export interface SolPriceUpdate {
  id: string;
  price: number;
  source: string;
  updated_at: string;
}

// Subscribe to SOL price updates
export function subscribeToSolPrice(
  onUpdate: (price: SolPriceUpdate) => void
): RealtimeChannel {
  const client = getSupabaseClient();

  console.log('[Realtime] Subscribing to SOL price updates');

  const channel = client
    .channel('sol-price')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'sol_price',
      },
      (payload) => {
        const record = payload.new as SolPriceUpdate;
        console.log('[Realtime] SOL price update:', record);
        onUpdate(record);
      }
    )
    .subscribe((status) => {
      console.log('[Realtime] SOL price subscription status:', status);
    });

  return channel;
}
