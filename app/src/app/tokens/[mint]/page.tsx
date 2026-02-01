'use client';

import { useState, useEffect, use, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { Token, Trade, TradeResponse } from '@/lib/types';
import TokenChat from '@/components/TokenChat';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { useWallet } from '@/contexts/WalletContext';

export default function TokenPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = use(params);
  const { connected, publicKey, balance: solBalance, connect, signAndSendTransaction } = useWallet();
  
  const [token, setToken] = useState<Token | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [solPrice, setSolPrice] = useState<number | null>(null);
  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const [trading, setTrading] = useState(false);
  const [tradeResult, setTradeResult] = useState<TradeResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [tokenBalance, setTokenBalance] = useState<number>(0);
  const [mockMode, setMockMode] = useState<boolean>(true);

  // Fetch token holdings for connected wallet
  const fetchTokenBalance = useCallback(async () => {
    if (!connected || !publicKey || !token) {
      setTokenBalance(0);
      return;
    }

    try {
      // In production, query SPL token accounts
      // For now, use mock or API
      const res = await fetch(`/api/balance?wallet=${publicKey}&mint=${mint}`);
      const data = await res.json();
      if (data.success) {
        setTokenBalance(data.tokenBalance || 0);
      }
    } catch (err) {
      console.error('Failed to fetch token balance:', err);
      // Fallback to 0
      setTokenBalance(0);
    }
  }, [connected, publicKey, token, mint]);

  // Check network mode on mount
  useEffect(() => {
    const checkNetworkMode = async () => {
      try {
        const res = await fetch('/api/network');
        const data = await res.json();
        setMockMode(data.mockMode !== false);
      } catch (err) {
        setMockMode(true); // Default to mock if check fails
      }
    };
    checkNetworkMode();
  }, []);

  useEffect(() => {
    fetchToken();
    fetchSolPrice();
  }, [mint]);

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

  useEffect(() => {
    if (token && connected) {
      fetchTokenBalance();
    }
  }, [token, connected, fetchTokenBalance]);

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

  // Update page title when token loads
  useEffect(() => {
    if (token) {
      document.title = `$${token.symbol} - ${token.name} | ClawdVault`;
    }
    return () => {
      document.title = 'ClawdVault 🦀 | Token Launchpad for AI Agents';
    };
  }, [token]);

  // Calculate estimated output
  const estimatedOutput = useMemo(() => {
    if (!token || !amount || parseFloat(amount) <= 0) return null;
    const inputAmount = parseFloat(amount);
    
    if (tradeType === 'buy') {
      const solAfterFee = inputAmount * 0.99;
      const k = token.virtual_sol_reserves * token.virtual_token_reserves;
      const newSolReserves = token.virtual_sol_reserves + solAfterFee;
      const newTokenReserves = k / newSolReserves;
      const tokensOut = token.virtual_token_reserves - newTokenReserves;
      return { tokens: tokensOut, sol: null };
    } else {
      const tokensAfterFee = inputAmount * 0.99;
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
      const expectedTokens = inputAmount / token.price_sol;
      const actualTokens = estimatedOutput?.tokens || 0;
      return ((expectedTokens - actualTokens) / expectedTokens) * 100;
    } else {
      const expectedSol = inputAmount * token.price_sol;
      const actualSol = estimatedOutput?.sol || 0;
      return ((expectedSol - actualSol) / expectedSol) * 100;
    }
  }, [token, amount, tradeType, estimatedOutput]);

  const handleTrade = async () => {
    if (!amount || !token || !connected || !publicKey) return;
    setTrading(true);
    setTradeResult(null);

    try {
      // Use mock mode API if no on-chain support
      if (mockMode) {
        const res = await fetch('/api/trade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mint: token.mint,
            type: tradeType,
            amount: parseFloat(amount),
            trader: publicKey,
          }),
        });

        const data: TradeResponse = await res.json();
        setTradeResult(data);

        if (data.success) {
          setAmount('');
          fetchToken();
          fetchTokenBalance();
        }
      } else {
        // On-chain trade flow
        // Step 1: Prepare transaction
        const prepareRes = await fetch('/api/trade/prepare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mint: token.mint,
            type: tradeType,
            amount: parseFloat(amount),
            wallet: publicKey,
            slippage: 0.01,
          }),
        });

        const prepareData = await prepareRes.json();
        if (!prepareData.success) {
          setTradeResult({ success: false, error: prepareData.error || 'Failed to prepare trade' });
          return;
        }

        // Step 2: Sign and send with wallet
        const signature = await signAndSendTransaction(prepareData.transaction);
        if (!signature) {
          setTradeResult({ success: false, error: 'Transaction cancelled or failed' });
          return;
        }

        // Step 3: Execute server-side completion
        const executeRes = await fetch('/api/trade/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mint: token.mint,
            type: tradeType,
            signedTransaction: signature, // Note: for signAndSend, this is actually the sig
            wallet: publicKey,
            expectedOutput: tradeType === 'buy' ? prepareData.output.tokens : prepareData.output.sol,
            solAmount: tradeType === 'buy' ? parseFloat(amount) : prepareData.output.sol,
            tokenAmount: tradeType === 'sell' ? parseFloat(amount) : prepareData.output.tokens,
          }),
        });

        const executeData = await executeRes.json();
        setTradeResult(executeData);

        if (executeData.success) {
          setAmount('');
          fetchToken();
          fetchTokenBalance();
        }
      }
    } catch (err) {
      console.error('Trade error:', err);
      setTradeResult({ success: false, error: 'Network error' });
    } finally {
      setTrading(false);
    }
  };

  const handleQuickSell = (percent: number) => {
    const tokenAmount = (tokenBalance * percent / 100);
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

  const formatUsd = (n: number) => {
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
    if (n >= 1) return '$' + n.toFixed(0);
    return '$' + n.toFixed(2);
  };

  const formatSol = (n: number) => {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M SOL';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K SOL';
    return n.toFixed(2) + ' SOL';
  };

  const formatValue = (solAmount: number) => {
    if (solPrice !== null) {
      return formatUsd(solAmount * solPrice);
    }
    return formatSol(solAmount);
  };

  const progressPercent = token 
    ? Math.min((token.real_sol_reserves / 85) * 100, 100)
    : 0;

  if (loading) {
    return (
      <main className="min-h-screen">
        <Header />
        <div className="flex items-center justify-center py-20">
          <div className="text-gray-400 animate-pulse">Loading...</div>
        </div>
      </main>
    );
  }

  if (!token) {
    return (
      <main className="min-h-screen">
        <Header />
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="text-6xl mb-4">🔍</div>
            <h1 className="text-2xl font-bold text-white mb-2">Token Not Found</h1>
            <Link href="/tokens" className="text-orange-400 hover:text-orange-300">
              Browse all tokens →
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <Header />

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
                  <div className="text-white font-mono text-lg">{formatValue(token.price_sol)}</div>
                  {solPrice !== null && (
                    <div className="text-gray-500 font-mono text-xs">{formatPrice(token.price_sol)} SOL</div>
                  )}
                </div>
                <div className="bg-gray-800/50 rounded-xl p-4">
                  <div className="text-gray-500 text-sm mb-1">Market Cap</div>
                  <div className="text-orange-400 font-mono text-lg">{formatValue(token.market_cap_sol)}</div>
                  {solPrice !== null && (
                    <div className="text-gray-500 font-mono text-xs">{formatNumber(token.market_cap_sol)} SOL</div>
                  )}
                </div>
                <div className="bg-gray-800/50 rounded-xl p-4">
                  <div className="text-gray-500 text-sm mb-1">24h Volume</div>
                  <div className="text-blue-400 font-mono text-lg">{formatValue(token.volume_24h || 0)}</div>
                  {solPrice !== null && (
                    <div className="text-gray-500 font-mono text-xs">{formatNumber(token.volume_24h || 0)} SOL</div>
                  )}
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
                  <span>{formatValue(token.real_sol_reserves)} raised</span>
                  <span>{formatValue(85)} goal</span>
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
                <div className="flex items-center justify-between mb-2">
                  <div className="text-gray-500 text-sm">Mint Address</div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(token.mint);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="text-gray-400 hover:text-white text-sm flex items-center gap-1 transition"
                    title="Copy to clipboard"
                  >
                    {copied ? '✅ Copied!' : '📋 Copy'}
                  </button>
                </div>
                <div className="font-mono text-sm text-orange-400 break-all">{token.mint}</div>
              </div>

              {/* Token Chat */}
              <TokenChat mint={token.mint} tokenSymbol={token.symbol} />
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
                  {/* User Balance - show if connected */}
                  {connected && (
                    <div className="bg-gray-700/50 rounded-lg p-3 mb-4">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Your SOL</span>
                        <span className="text-white font-mono">
                          {solBalance !== null ? solBalance.toFixed(4) : '...'}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm mt-1">
                        <span className="text-gray-400">Your ${token.symbol}</span>
                        <span className="text-white font-mono">{formatNumber(tokenBalance)}</span>
                      </div>
                    </div>
                  )}

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
                      {connected && (
                        <span className="text-gray-500">
                          Max: {tradeType === 'buy' 
                            ? (solBalance?.toFixed(4) || '0') + ' SOL'
                            : formatNumber(tokenBalance)
                          }
                        </span>
                      )}
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
                          ? (solBalance || 0).toString() 
                          : tokenBalance.toString()
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
                  ) : connected ? (
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
                  ) : null}

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
                  {connected ? (
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
                  ) : (
                    <div className="space-y-3">
                      <button
                        onClick={connect}
                        className="w-full py-3 rounded-lg font-semibold transition bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white flex items-center justify-center gap-2"
                      >
                        <svg className="w-5 h-5" viewBox="0 0 200 180" fill="none">
                          <path fillRule="evenodd" clipRule="evenodd" d="M89.1138 112.613C83.1715 121.719 73.2139 133.243 59.9641 133.243C53.7005 133.243 47.6777 130.665 47.6775 119.464C47.677 90.9369 86.6235 46.777 122.76 46.7764C143.317 46.776 151.509 61.0389 151.509 77.2361C151.509 98.0264 138.018 121.799 124.608 121.799C120.352 121.799 118.264 119.462 118.264 115.756C118.264 114.789 118.424 113.741 118.746 112.613C114.168 120.429 105.335 127.683 97.0638 127.683C91.0411 127.683 87.9898 123.895 87.9897 118.576C87.9897 116.642 88.3912 114.628 89.1138 112.613ZM115.936 68.7103C112.665 68.7161 110.435 71.4952 110.442 75.4598C110.449 79.4244 112.689 82.275 115.96 82.2693C119.152 82.2636 121.381 79.4052 121.374 75.4405C121.367 71.4759 119.128 68.7047 115.936 68.7103ZM133.287 68.6914C130.016 68.6972 127.786 71.4763 127.793 75.4409C127.8 79.4055 130.039 82.2561 133.311 82.2504C136.503 82.2448 138.732 79.3863 138.725 75.4216C138.718 71.457 136.479 68.6858 133.287 68.6914Z" fill="currentColor"/>
                        </svg>
                        Connect Phantom Wallet
                      </button>
                      <div className="text-gray-500 text-xs text-center">
                        <p>Don&apos;t have Phantom?{' '}
                          <a 
                            href="https://phantom.app/" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-purple-400 hover:text-purple-300 underline"
                          >
                            Download here
                          </a>
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="text-gray-500 text-xs text-center mt-4">
                    1% fee on all trades
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
