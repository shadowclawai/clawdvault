'use client';

import { useState, useEffect, useCallback } from 'react';
import { subscribeToSolPrice, unsubscribeChannel, SolPriceUpdate } from '@/lib/supabase-client';
import { RealtimeChannel } from '@supabase/supabase-js';

interface SolPriceState {
  price: number | null;
  source: string | null;
  updatedAt: Date | null;
  age: number; // seconds
  isValid: boolean;
  loading: boolean;
  error: string | null;
}

interface UseSolPriceOptions {
  /** Initial fetch on mount (default: true) */
  fetchOnMount?: boolean;
  /** Subscribe to realtime updates (default: true) */
  realtime?: boolean;
}

/**
 * React hook for SOL price with optional realtime updates
 * 
 * Usage:
 * ```tsx
 * const { price, isValid, loading } = useSolPrice();
 * 
 * // Display price
 * {price && `$${price.toFixed(2)}`}
 * ```
 */
export function useSolPrice(options: UseSolPriceOptions = {}): SolPriceState {
  const { fetchOnMount = true, realtime = true } = options;
  
  const [state, setState] = useState<SolPriceState>({
    price: null,
    source: null,
    updatedAt: null,
    age: 0,
    isValid: false,
    loading: fetchOnMount,
    error: null,
  });
  
  // Fetch price from API
  const fetchPrice = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const res = await fetch('/api/sol-price');
      
      if (!res.ok) {
        throw new Error(`Failed to fetch price: ${res.status}`);
      }
      
      const data = await res.json();
      
      setState({
        price: data.price,
        source: data.source,
        updatedAt: new Date(data.updatedAt),
        age: data.age,
        isValid: data.valid,
        loading: false,
        error: null,
      });
    } catch (err) {
      console.error('[useSolPrice] Fetch failed:', err);
      setState(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }));
    }
  }, []);
  
  // Handle realtime update
  const handleRealtimeUpdate = useCallback((update: SolPriceUpdate) => {
    const now = Date.now();
    const updatedAt = new Date(update.updated_at);
    const age = Math.floor((now - updatedAt.getTime()) / 1000);
    
    setState({
      price: update.price,
      source: update.source,
      updatedAt,
      age,
      isValid: age < 120,
      loading: false,
      error: null,
    });
  }, []);
  
  // Initial fetch
  useEffect(() => {
    if (fetchOnMount) {
      fetchPrice();
    }
  }, [fetchOnMount, fetchPrice]);
  
  // Setup realtime subscription
  useEffect(() => {
    if (!realtime) return;
    
    let channel: RealtimeChannel;
    
    try {
      channel = subscribeToSolPrice(handleRealtimeUpdate);
    } catch (err) {
      console.error('[useSolPrice] Failed to subscribe:', err);
    }
    
    return () => {
      if (channel) {
        unsubscribeChannel(channel);
      }
    };
  }, [realtime, handleRealtimeUpdate]);
  
  return state;
}

/**
 * Hook for converting SOL amount to USD
 * Automatically updates when SOL price changes
 */
export function useSolToUsd(solAmount: number | null | undefined): {
  usdAmount: number | null;
  price: number | null;
  loading: boolean;
} {
  const { price, loading } = useSolPrice();
  
  const usdAmount = solAmount != null && price != null
    ? solAmount * price
    : null;
  
  return { usdAmount, price, loading };
}

export default useSolPrice;
