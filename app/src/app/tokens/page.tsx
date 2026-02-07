'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { Token, TokenListResponse } from '@/lib/types';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { subscribeToAllTokens, unsubscribeChannel } from '@/lib/supabase-client';
import { useWallet } from '@/contexts/WalletContext';

type FilterTab = 'all' | 'trending' | 'new' | 'graduated';

export default function TokensPage() {
  const { connected, publicKey } = useWallet();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState('created_at');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterTab>('all');
  const [solPrice, setSolPrice] = useState<number | null>(null);
  const [walletBalances, setWalletBalances] = useState<Record<string, number>>({});
  const [balancesLoading, setBalancesLoading] = useState(false);

  // Fetch wallet token balances
  const fetchWalletBalances = useCallback(async () => {
    if (!connected || !publicKey) {
      setWalletBalances({});
      return;
    }

    setBalancesLoading(true);
    try {
      const res = await fetch(`/api/wallet/balances?wallet=${publicKey}`);
      const data = await res.json();
      if (data.success) {
        setWalletBalances(data.balances || {});
      }
    } catch (err) {
      console.warn('Failed to fetch wallet balances:', err);
      setWalletBalances({});
    } finally {
      setBalancesLoading(false);
    }
  }, [connected, publicKey]);

  useEffect(() => {
    fetchTokens();
    fetchSolPrice();
    
    // Subscribe to realtime token updates
    const channel = subscribeToAllTokens(
      // On new token
      (newToken) => {
        setTokens(prev => [newToken, ...prev]);
      },
      // On token update
      (updatedToken) => {
        setTokens(prev => prev.map(t => 
          t.mint === updatedToken.mint ? { ...t, ...updatedToken } : t
        ));
      }
    );
    
    return () => unsubscribeChannel(channel);
  }, [sort]);

  // Fetch wallet balances when connection changes
  useEffect(() => {
    fetchWalletBalances();
  }, [fetchWalletBalances]);

  const fetchSolPrice = async () => {
    try {
      const res = await fetch('/api/sol-price');
      const data = await res.json();
      setSolPrice(data.valid ? data.price : null);
    } catch (err) {
      console.warn('Price fetch failed');
      setSolPrice(null);
    }
  };

  const fetchTokens = async () => {
    try {
      const res = await fetch(`/api/tokens?sort=${sort}`);
      const data: TokenListResponse = await res.json();
      setTokens(data.tokens || []);
    } catch (err) {
      console.error('Failed to fetch tokens:', err);
      setTokens([]);
    } finally {
      setLoading(false);
    }
  };

  // Filter and search tokens
  const filteredTokens = useMemo(() => {
    if (!tokens || !Array.isArray(tokens)) return [];
    let result = [...tokens];

    // Apply tab filter
    switch (filter) {
      case 'trending':
        result = result.sort((a, b) => (b.volume_24h || 0) - (a.volume_24h || 0)).slice(0, 20);
        break;
      case 'new':
        result = result.filter((t) => {
          const created = new Date(t.created_at);
          const hourAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          return created > hourAgo;
        });
        break;
      case 'graduated':
        result = result.filter((t) => t.graduated);
        break;
    }

    // Apply search
    if (search.trim()) {
      const query = search.toLowerCase().trim();
      result = result.filter((t) =>
        t.symbol.toLowerCase().includes(query) ||
        t.name.toLowerCase().includes(query) ||
        t.mint.toLowerCase().includes(query) ||
        (t.creator_name && t.creator_name.toLowerCase().includes(query))
      );
    }

    return result;
  }, [tokens, filter, search]);

  const formatUsd = (n: number) => {
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
    if (n >= 1) return '$' + n.toFixed(2);
    if (n >= 0.01) return '$' + n.toFixed(4);
    if (n >= 0.0001) return '$' + n.toFixed(6);
    if (n >= 0.000001) return '$' + n.toFixed(8);
    return '$' + n.toFixed(10);
    return '<$0.0001';
  };

  const formatSol = (n: number) => {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M SOL';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K SOL';
    if (n >= 0.01) return n.toFixed(4) + ' SOL';
    if (n >= 0.0001) return n.toFixed(6) + ' SOL';
    return n.toFixed(9) + ' SOL';
  };

  const formatValue = (solAmount: number) => {
    if (solPrice !== null) {
      return formatUsd(solAmount * solPrice);
    }
    return formatSol(solAmount);
  };

  const formatPrice = (price: number) => {
    if (price < 0.0000000001) return '<0.0000000001 SOL';
    if (price < 0.000001) return price.toFixed(12) + ' SOL';
    if (price < 0.001) return price.toFixed(9) + ' SOL';
    return price.toFixed(6) + ' SOL';
  };

  const formatMcap = (mcapSol: number, mcapUsd?: number) => {
    if (mcapUsd !== undefined && mcapUsd !== null) {
      // Use USD market cap directly from API (based on last trade)
      if (mcapUsd >= 1000000) return '$' + (mcapUsd / 1000000).toFixed(1) + 'M';
      if (mcapUsd >= 1000) return '$' + (mcapUsd / 1000).toFixed(1) + 'K';
      return '$' + mcapUsd.toFixed(0);
    }
    // Fallback: convert SOL market cap using current SOL price
    if (mcapSol >= 1000) return (mcapSol / 1000).toFixed(1) + 'K SOL';
    return mcapSol.toFixed(2) + ' SOL';
  };

  const formatVolume = (vol?: number) => {
    if (!vol) return '--';
    if (vol >= 1000) return (vol / 1000).toFixed(1) + 'K';
    return vol.toFixed(2);
  };

  const formatNumber = (n: number) => {
    if (n >= 1000000000) return (n / 1000000000).toFixed(2) + 'B';
    if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(2) + 'K';
    return n.toFixed(2);
  };

  const formatTimeAgo = (date: string) => {
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  const tabs: { id: FilterTab; label: string; icon: string }[] = [
    { id: 'all', label: 'All', icon: '🌐' },
    { id: 'trending', label: 'Trending', icon: '🔥' },
    { id: 'new', label: 'New', icon: '✨' },
    { id: 'graduated', label: 'Graduated', icon: '🎓' },
  ];

  return (
    <main className="min-h-screen">
      <Header />

      {/* Content */}
      <section className="py-8 px-6">
        <div className="max-w-6xl mx-auto">
          {/* Search & Filters */}
          <div className="mb-6 space-y-4">
            {/* Search Bar */}
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                🔍
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, symbol, mint, or creator..."
                className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-12 pr-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Tabs & Sort */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              {/* Filter Tabs */}
              <div className="flex bg-gray-800 rounded-lg p-1">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setFilter(tab.id)}
                    className={`px-4 py-2 rounded-md text-sm transition flex items-center gap-2 ${
                      filter === tab.id
                        ? 'bg-orange-500 text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <span>{tab.icon}</span>
                    <span className="hidden sm:inline">{tab.label}</span>
                  </button>
                ))}
              </div>

              {/* Sort Dropdown */}
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-orange-500"
              >
                <option value="created_at">Newest</option>
                <option value="market_cap">Market Cap</option>
                <option value="volume">24h Volume</option>
                <option value="price">Price</option>
              </select>
            </div>
          </div>

          {/* Results count */}
          {search && (
            <div className="text-gray-400 text-sm mb-4">
              Found {filteredTokens.length} token{filteredTokens.length !== 1 ? 's' : ''} matching "{search}"
            </div>
          )}

          {loading ? (
            <div className="text-center text-gray-400 py-12">
              <div className="animate-pulse">Loading tokens...</div>
            </div>
          ) : filteredTokens.length === 0 ? (
            <div className="text-center py-12">
              {search ? (
                <>
                  <div className="text-6xl mb-4">🔍</div>
                  <h2 className="text-xl font-bold text-white mb-2">No tokens found</h2>
                  <p className="text-gray-400 mb-6">Try a different search term</p>
                  <button
                    onClick={() => setSearch('')}
                    className="text-orange-400 hover:text-orange-300 transition"
                  >
                    Clear search
                  </button>
                </>
              ) : filter !== 'all' ? (
                <>
                  <div className="text-6xl mb-4">{tabs.find(t => t.id === filter)?.icon}</div>
                  <h2 className="text-xl font-bold text-white mb-2">No {filter} tokens</h2>
                  <button
                    onClick={() => setFilter('all')}
                    className="text-orange-400 hover:text-orange-300 transition"
                  >
                    View all tokens
                  </button>
                </>
              ) : (
                <>
                  <div className="text-6xl mb-4">🦞</div>
                  <h2 className="text-xl font-bold text-white mb-2">No tokens yet</h2>
                  <p className="text-gray-400 mb-6">Be the first to launch!</p>
                  <Link
                    href="/create"
                    className="inline-block bg-orange-500 hover:bg-orange-400 text-white px-6 py-3 rounded-lg transition"
                  >
                    Create Token
                  </Link>
                </>
              )}
            </div>
          ) : (
            <div className="grid gap-4">
              {filteredTokens.map((token) => (
                <Link
                  key={token.mint}
                  href={`/tokens/${token.mint}`}
                  className="bg-gray-800/50 border border-gray-700 hover:border-orange-500 rounded-xl p-4 transition flex items-center gap-4 group"
                >
                  {/* Image */}
                  <div className="w-12 h-12 bg-gray-700 rounded-full flex items-center justify-center text-2xl flex-shrink-0 group-hover:scale-110 transition">
                    {token.image ? (
                      <img src={token.image} alt="" className="w-full h-full rounded-full object-cover" />
                    ) : (
                      '🪙'
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-white">${token.symbol}</span>
                      {token.graduated && (
                        <span className="bg-green-500/20 text-green-400 text-xs px-2 py-0.5 rounded-full">
                          🎓 Graduated
                        </span>
                      )}
                      <span className="text-gray-500 text-xs">
                        {formatTimeAgo(token.created_at)}
                      </span>
                    </div>
                    <div className="text-gray-400 text-sm truncate">{token.name}</div>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 text-xs">by {token.creator_name || 'Anonymous'}</span>
                      {/* Mobile price - shows only on xs screens */}
                      <span className="text-orange-400 text-xs font-mono sm:hidden">
                        {formatMcap(token.market_cap_sol, token.market_cap_usd)}
                      </span>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="text-right hidden sm:block">
                    <div className="text-white font-mono">{formatPrice(token.price_sol)}</div>
                    <div className="text-gray-500 text-sm">Price</div>
                  </div>
                  <div className="text-right hidden md:block">
                    <div className="text-orange-400 font-mono">{formatMcap(token.market_cap_sol, token.market_cap_usd)}</div>
                    <div className="text-gray-500 text-sm">MCap</div>
                  </div>
                  <div className="text-right hidden lg:block">
                    <div className="text-blue-400 font-mono">
                      {token.volume_24h && token.volume_24h > 0.001 
                        ? formatValue(token.volume_24h) 
                        : '--'}
                    </div>
                    <div className="text-gray-500 text-sm">24h Vol</div>
                  </div>
                  
                  {/* User Balance - shown when wallet is connected and user has balance */}
                  {connected && walletBalances[token.mint] > 0 && (
                    <div className="text-right hidden md:block">
                      <div className="text-green-400 font-mono">
                        {formatNumber(walletBalances[token.mint])}
                      </div>
                      <div className="text-gray-500 text-sm">Your Balance</div>
                    </div>
                  )}

                  {/* Arrow */}
                  <div className="text-gray-600 group-hover:text-orange-400 transition">
                    →
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      <Footer />
    </main>
  );
}
