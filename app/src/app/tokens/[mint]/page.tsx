'use client';

import { useState, useEffect, use, useMemo } from 'react';
import Link from 'next/link';
import { Token, Trade, TradeResponse } from '@/lib/types';

export default function TokenPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = use(params);
  const [token, setToken] = useState<Token | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const [trading, setTrading] = useState(false);
  const [tradeResult, setTradeResult] = useState<TradeResponse | null>(null);

  // Mock user balance (in real app, fetch from wallet)
  const [userBalance] = useState({
    sol: 10.5,
    tokens: 1000000, // User owns 1M tokens
  });

  useEffect(() => {
    fetchToken();
  }, [mint]);

  const fetchToken = async () => {
    try {
      const res = await fetch(`/api/tokens/${mint}`);
      const data = await res.json();
      if (data.token) {
        setToken(data.token);
        setTrades(data.trades || []);
      }
    } catch (err) {
      console.error('Failed to fetch token:', err);
    } finally {
      setLoading(false);
    }
  };

  // Calculate estimated output
  const estimatedOutput = useMemo(() => {
    if (!token || !amount || parseFloat(amount) <= 0) return null;
    const inputAmount = parseFloat(amount);
    
    if (tradeType === 'buy') {
      // Buy: SOL -> tokens
      const solAfterFee = inputAmount * 0.99; // 1% fee
      const k = token.virtual_sol_reserves * token.virtual_token_reserves;
      const newSolReserves = token.virtual_sol_reserves + solAfterFee;
      const newTokenReserves = k / newSolReserves;
      const tokensOut = token.virtual_token_reserves - newTokenReserves;
      return { tokens: tokensOut, sol: null };
    } else {
      // Sell: tokens -> SOL
      const tokensAfterFee = inputAmount * 0.99; // 1% fee
      const k = token.virtual_sol_reserves * token.virtual_token_reserves;
      const newTokenReserves = token.virtual_token_reserves + tokensAfterFee;
      const newSolReserves = k / newTokenReserves;
      const solOut = token.virtual_sol_reserves - newSolReserves;
      return { tokens: null, sol: solOut };
    }
  }, [token, amount, tradeType]);

  // Calculate price impact
  const priceImpact = useMemo(() => {
    if (!token || !amount || parseFloat(amount) <= 0) return 0;
    const inputAmount = parseFloat(amount);
    
    if (tradeType === 'buy') {
      // How much price increases when buying
      const expectedTokens = inputAmount / token.price_sol;
      const actualTokens = estimatedOutput?.tokens || 0;
      return ((expectedTokens - actualTokens) / expectedTokens) * 100;
    } else {
      // How much price decreases when selling
      const expectedSol = inputAmount * token.price_sol;
      const actualSol = estimatedOutput?.sol || 0;
      return ((expectedSol - actualSol) / expectedSol) * 100;
    }
  }, [token, amount, tradeType, estimatedOutput]);

  const handleTrade = async () => {
    if (!amount || !token) return;
    setTrading(true);
    setTradeResult(null);

    try {
      const res = await fetch('/api/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mint: token.mint,
          type: tradeType,
          amount: parseFloat(amount),
        }),
      });

      const data: TradeResponse = await res.json();
      setTradeResult(data);

      if (data.success) {
        setAmount('');
        fetchToken();
      }
    } catch (err) {
      setTradeResult({ success: false, error: 'Network error' });
    } finally {
      setTrading(false);
    }
  };

  const handleQuickSell = (percent: number) => {
    const tokenAmount = (userBalance.tokens * percent / 100);
    setAmount(tokenAmount.toString());
  };

  const formatPrice = (price: number) => {
    if (price < 0.000001) return '<0.000001';
    if (price < 0.001) return price.toFixed(8);
    return price.toFixed(6);
  };

  const formatNumber = (n: number) => {
    if (n >= 1000000000) return (n / 1000000000).toFixed(2) + 'B';
    if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(2) + 'K';
    return n.toFixed(2);
  };

  const progressPercent = token 
    ? Math.min((token.real_sol_reserves / 85) * 100, 100)
    : 0;

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400 animate-pulse">Loading...</div>
      </main>
    );
  }

  if (!token) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">🔍</div>
          <h1 className="text-2xl font-bold text-white mb-2">Token Not Found</h1>
          <Link href="/tokens" className="text-orange-400 hover:text-orange-300">
            Browse all tokens →
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-2xl">🦀</span>
            <span className="text-xl font-bold text-white">ClawdVault</span>
          </Link>
          <nav className="flex items-center gap-6">
            <Link href="/create" className="text-gray-400 hover:text-white transition">
              Create Token
            </Link>
            <Link href="/tokens" className="text-gray-400 hover:text-white transition">
              Browse
            </Link>
          </nav>
        </div>
      </header>

      <section className="py-8 px-6">
        <div className="max-w-6xl mx-auto">
          {/* Token Header */}
          <div className="flex items-start gap-6 mb-8">
            <div className="w-20 h-20 bg-gray-700 rounded-full flex items-center justify-center text-4xl flex-shrink-0">
              {token.image ? (
                <img src={token.image} alt="" className="w-full h-full rounded-full object-cover" />
              ) : (
                '🪙'
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-bold text-white">${token.symbol}</h1>
                {token.graduated && (
                  <span className="bg-green-500/20 text-green-400 px-3 py-1 rounded-full text-sm">
                    🎓 Graduated
                  </span>
                )}
              </div>
              <div className="text-gray-400 mb-1">{token.name}</div>
              <div className="text-gray-500 text-sm">Created by {token.creator_name || 'Anonymous'}</div>
              {token.description && (
                <p className="text-gray-400 mt-2">{token.description}</p>
              )}
              
              {/* Social Links */}
              {(token.twitter || token.telegram || token.website) && (
                <div className="flex items-center gap-3 mt-3">
                  {token.twitter && (
                    <a
                      href={token.twitter.startsWith('http') ? token.twitter : `https://twitter.com/${token.twitter.replace('@', '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-3 py-1.5 rounded-lg text-sm transition flex items-center gap-2"
                    >
                      <span>𝕏</span>
                      <span>Twitter</span>
                    </a>
                  )}
                  {token.telegram && (
                    <a
                      href={token.telegram.startsWith('http') ? token.telegram : `https://t.me/${token.telegram.replace('@', '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-3 py-1.5 rounded-lg text-sm transition flex items-center gap-2"
                    >
                      <span>✈️</span>
                      <span>Telegram</span>
                    </a>
                  )}
                  {token.website && (
                    <a
                      href={token.website.startsWith('http') ? token.website : `https://${token.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-3 py-1.5 rounded-lg text-sm transition flex items-center gap-2"
                    >
                      <span>🌐</span>
                      <span>Website</span>
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Stats */}
            <div className="lg:col-span-2 space-y-6">
              {/* Price & Market Cap */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gray-800/50 rounded-xl p-4">
                  <div className="text-gray-500 text-sm mb-1">Price</div>
                  <div className="text-white font-mono text-lg">{formatPrice(token.price_sol)} SOL</div>
                </div>
                <div className="bg-gray-800/50 rounded-xl p-4">
                  <div className="text-gray-500 text-sm mb-1">Market Cap</div>
                  <div className="text-orange-400 font-mono text-lg">{formatNumber(token.market_cap_sol)} SOL</div>
                </div>
                <div className="bg-gray-800/50 rounded-xl p-4">
                  <div className="text-gray-500 text-sm mb-1">24h Volume</div>
                  <div className="text-blue-400 font-mono text-lg">{formatNumber(token.volume_24h || 0)} SOL</div>
                </div>
                <div className="bg-gray-800/50 rounded-xl p-4">
                  <div className="text-gray-500 text-sm mb-1">Holders</div>
                  <div className="text-amber-400 font-mono text-lg">{token.holders || '--'}</div>
                </div>
              </div>

              {/* Graduation Progress */}
              <div className="bg-gray-800/50 rounded-xl p-4">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-400">Graduation Progress</span>
                  <span className="text-orange-400">{progressPercent.toFixed(1)}%</span>
                </div>
                <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-orange-500 to-red-500 transition-all duration-500"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-500 mt-2">
                  <span>{formatNumber(token.real_sol_reserves)} SOL raised</span>
                  <span>85 SOL goal (~$69K)</span>
                </div>
              </div>

              {/* Recent Trades */}
              <div className="bg-gray-800/50 rounded-xl p-4">
                <h3 className="text-white font-semibold mb-4">Recent Trades</h3>
                {trades.length === 0 ? (
                  <div className="text-gray-500 text-center py-4">No trades yet</div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {trades.map((trade) => (
                      <div key={trade.id} className="flex items-center justify-between text-sm py-2 border-b border-gray-700/50 last:border-0">
                        <div className="flex items-center gap-2">
                          <span className={trade.type === 'buy' ? 'text-green-400' : 'text-red-400'}>
                            {trade.type === 'buy' ? '🟢' : '🔴'}
                          </span>
                          <span className="text-gray-400">
                            {trade.type === 'buy' ? 'Buy' : 'Sell'}
                          </span>
                        </div>
                        <div className="text-white font-mono">
                          {formatNumber(trade.token_amount)} tokens
                        </div>
                        <div className="text-gray-400 font-mono">
                          {trade.sol_amount.toFixed(4)} SOL
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Mint Address */}
              <div className="bg-gray-800/50 rounded-xl p-4">
                <div className="text-gray-500 text-sm mb-2">Mint Address</div>
                <div className="font-mono text-sm text-orange-400 break-all">{token.mint}</div>
              </div>
            </div>

            {/* Trade Panel */}
            <div className="bg-gray-800/50 rounded-xl p-6 h-fit sticky top-6">
              <h3 className="text-white font-semibold mb-4">Trade</h3>

              {token.graduated ? (
                <div className="text-center py-6">
                  <div className="text-4xl mb-2">🎓</div>
                  <div className="text-white font-medium mb-2">Graduated!</div>
                  <div className="text-gray-400 text-sm mb-4">
                    This token has graduated to Raydium.
                  </div>
                  <a
                    href={`https://raydium.io/swap/?inputCurrency=sol&outputCurrency=${token.mint}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block bg-orange-500 hover:bg-orange-400 text-white px-6 py-2 rounded-lg transition"
                  >
                    Trade on Raydium
                  </a>
                </div>
              ) : (
                <>
                  {/* User Balance */}
                  <div className="bg-gray-700/50 rounded-lg p-3 mb-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Your SOL</span>
                      <span className="text-white font-mono">{userBalance.sol.toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-gray-400">Your ${token.symbol}</span>
                      <span className="text-white font-mono">{formatNumber(userBalance.tokens)}</span>
                    </div>
                  </div>

                  {/* Buy/Sell Toggle */}
                  <div className="flex bg-gray-700 rounded-lg p-1 mb-4">
                    <button
                      onClick={() => { setTradeType('buy'); setAmount(''); }}
                      className={`flex-1 py-2 rounded-md transition ${
                        tradeType === 'buy'
                          ? 'bg-green-600 text-white'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      Buy
                    </button>
                    <button
                      onClick={() => { setTradeType('sell'); setAmount(''); }}
                      className={`flex-1 py-2 rounded-md transition ${
                        tradeType === 'sell'
                          ? 'bg-red-600 text-white'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      Sell
                    </button>
                  </div>

                  {/* Amount Input */}
                  <div className="mb-3">
                    <div className="flex justify-between text-sm mb-2">
                      <label className="text-gray-400">
                        {tradeType === 'buy' ? 'SOL Amount' : 'Token Amount'}
                      </label>
                      <span className="text-gray-500">
                        Max: {tradeType === 'buy' 
                          ? userBalance.sol.toFixed(4) + ' SOL'
                          : formatNumber(userBalance.tokens)
                        }
                      </span>
                    </div>
                    <div className="relative">
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        step="any"
                        min="0"
                        className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white text-lg font-mono placeholder-gray-500 focus:border-orange-500 focus:outline-none pr-16"
                      />
                      <button
                        onClick={() => setAmount(tradeType === 'buy' 
                          ? userBalance.sol.toString() 
                          : userBalance.tokens.toString()
                        )}
                        className="absolute right-2 top-1/2 -translate-y-1/2 bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 px-2 py-1 rounded text-sm transition"
                      >
                        MAX
                      </button>
                    </div>
                  </div>

                  {/* Quick amounts */}
                  {tradeType === 'buy' ? (
                    <div className="flex gap-2 mb-4">
                      {[0.1, 0.5, 1, 5].map((val) => (
                        <button
                          key={val}
                          onClick={() => setAmount(val.toString())}
                          className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 py-1.5 rounded text-sm transition"
                        >
                          {val} SOL
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex gap-2 mb-4">
                      {[25, 50, 75, 100].map((percent) => (
                        <button
                          key={percent}
                          onClick={() => handleQuickSell(percent)}
                          className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 py-1.5 rounded text-sm transition"
                        >
                          {percent === 100 ? 'MAX' : `${percent}%`}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Estimated Output */}
                  {estimatedOutput && (
                    <div className="bg-gray-700/50 rounded-lg p-3 mb-4">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">You'll receive (est.)</span>
                        <span className="text-white font-mono">
                          {tradeType === 'buy' 
                            ? formatNumber(estimatedOutput.tokens || 0) + ' ' + token.symbol
                            : (estimatedOutput.sol || 0).toFixed(6) + ' SOL'
                          }
                        </span>
                      </div>
                      <div className="flex justify-between text-sm mt-1">
                        <span className="text-gray-400">Price Impact</span>
                        <span className={`font-mono ${
                          priceImpact > 5 ? 'text-red-400' : 
                          priceImpact > 2 ? 'text-yellow-400' : 
                          'text-green-400'
                        }`}>
                          {priceImpact.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Price Impact Warning */}
                  {priceImpact > 5 && (
                    <div className="bg-red-900/30 border border-red-500/50 rounded-lg p-3 mb-4">
                      <div className="text-red-400 text-sm flex items-center gap-2">
                        <span>⚠️</span>
                        <span>High price impact! Consider smaller trade.</span>
                      </div>
                    </div>
                  )}

                  {/* Trade Result */}
                  {tradeResult && (
                    <div className={`mb-4 p-3 rounded-lg ${
                      tradeResult.success 
                        ? 'bg-green-900/30 border border-green-500' 
                        : 'bg-red-900/30 border border-red-500'
                    }`}>
                      {tradeResult.success ? (
                        <div className="text-green-400 text-sm">
                          ✅ Trade successful!
                          {tradeResult.tokens_received && (
                            <div>Received: {formatNumber(tradeResult.tokens_received)} tokens</div>
                          )}
                          {tradeResult.sol_received && (
                            <div>Received: {tradeResult.sol_received.toFixed(6)} SOL</div>
                          )}
                        </div>
                      ) : (
                        <div className="text-red-400 text-sm">
                          ❌ {tradeResult.error}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Trade Button */}
                  <button
                    onClick={handleTrade}
                    disabled={trading || !amount || parseFloat(amount) <= 0}
                    className={`w-full py-3 rounded-lg font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed ${
                      tradeType === 'buy'
                        ? 'bg-green-600 hover:bg-green-500 text-white'
                        : 'bg-red-600 hover:bg-red-500 text-white'
                    }`}
                  >
                    {trading ? 'Processing...' : tradeType === 'buy' ? 'Buy Tokens' : 'Sell Tokens'}
                  </button>

                  <div className="text-gray-500 text-xs text-center mt-4">
                    1% fee on all trades
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
