'use client';

import { useState, useEffect, use, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { Token, Trade, TradeResponse } from '@/lib/types';
import ChatAndTrades from '@/components/ChatAndTrades';
import PriceChart from '@/components/PriceChart';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import ExplorerLink from '@/components/ExplorerLink';
import { useWallet } from '@/contexts/WalletContext';
import { fetchBalanceClient } from '@/lib/solana-client';
import { subscribeToTokenStats, unsubscribeChannel } from '@/lib/supabase-client';

export default function TokenPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = use(params);
  const { connected, publicKey, balance: solBalance, connect, signTransaction, refreshBalance } = useWallet();
  const [anchorAvailable, setAnchorAvailable] = useState<boolean | null>(null);
  
  const [token, setToken] = useState<Token | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [solPrice, setSolPrice] = useState<number | null>(null);
  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const [trading, setTrading] = useState(false);
  const [chartKey, setChartKey] = useState(0); // Increment to force chart refresh
  const [tradeResult, setTradeResult] = useState<TradeResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [tokenBalance, setTokenBalance] = useState<number>(0);
  const [tokenBalanceLoading, setTokenBalanceLoading] = useState(false);
  const [holders, setHolders] = useState<Array<{
    address: string;
    balance: number;
    percentage: number;
    label?: string;
  }>>([]);
  const [holdersLoading, setHoldersLoading] = useState(true);
  const [circulatingSupply, setCirculatingSupply] = useState<number>(0);
  const [onChainStats, setOnChainStats] = useState<{
    marketCap: number;
    marketCapUsd?: number;
    price: number;
    priceUsd?: number;
    solPriceUsd?: number;
    bondingCurveSol: number;
  } | null>(null);
  const [candleMarketCap, setCandleMarketCap] = useState<number>(0);
  const [creatorUsername, setCreatorUsername] = useState<string | null>(null);

  // Effective market cap: on-chain initially, then candles after first update
  // Candles include heartbeat candles, so they stay updated with current SOL price
  const displayMarketCap = candleMarketCap > 0 ? candleMarketCap : (onChainStats?.marketCapUsd ?? 0);

  // Current price from last candle (includes heartbeat candles for USD continuity)
  const currentPrice = useMemo(() => {
    // Return on-chain stats which now come from last candle via API
    return {
      sol: onChainStats?.price ?? 0,
      usd: onChainStats?.priceUsd ?? null,
    };
  }, [onChainStats]);

  // Fetch token holdings for connected wallet (client-side RPC)
  const fetchTokenBalance = useCallback(async () => {
    if (!connected || !publicKey || !token) {
      setTokenBalance(0);
      setTokenBalanceLoading(false);
      return;
    }

    setTokenBalanceLoading(true);
    try {
      // Use client-side RPC to avoid rate limiting
      const balance = await fetchBalanceClient(mint, publicKey);
      setTokenBalance(balance);
      setTokenBalanceLoading(false);
    } catch (err) {
      console.error('Failed to fetch token balance:', err);
      // Fallback to API
      try {
        const res = await fetch(`/api/balance?wallet=${publicKey}&mint=${mint}`);
        const data = await res.json();
        if (data.success) {
          setTokenBalance(data.tokenBalance || 0);
        }
      } catch (e) {
        setTokenBalance(0);
      } finally {
        setTokenBalanceLoading(false);
      }
    }
  }, [connected, publicKey, token, mint]);

  // Refresh both SOL and token balances after trade
  const refreshBalancesAfterTrade = useCallback(async () => {
    // Refresh SOL balance immediately
    await refreshBalance();
    
    // Wait a bit for blockchain to settle, then refresh token balance
    // First attempt after 500ms
    setTimeout(async () => {
      await fetchTokenBalance();
      
      // Second attempt after 2 seconds to ensure finality
      setTimeout(async () => {
        await fetchTokenBalance();
      }, 1500);
    }, 500);
  }, [refreshBalance, fetchTokenBalance]);

  const fetchHolders = useCallback(async (creator?: string) => {
    setHoldersLoading(true);
    try {
      // Use API endpoint (client-side RPC blocked by Solana Labs CORS)
      const url = creator 
        ? `/api/holders?mint=${mint}&creator=${creator}`
        : `/api/holders?mint=${mint}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        setHolders(data.holders || []);
        setCirculatingSupply(data.circulatingSupply || 0);
      }
    } catch (err) {
      console.warn('Holders fetch failed:', err);
    } finally {
      setHoldersLoading(false);
    }
  }, [mint]);

  useEffect(() => {
    fetchToken();
    fetchSolPrice();
    fetchNetworkMode();
    fetchOnChainStats();
    
    // Subscribe to realtime token stats updates
    const tokenChannel = subscribeToTokenStats(mint, (updatedToken) => {
      // Update token state with new reserves/stats
      setToken(prev => prev ? {
        ...prev,
        virtual_sol_reserves: updatedToken.virtual_sol_reserves,
        virtual_token_reserves: updatedToken.virtual_token_reserves,
        real_sol_reserves: updatedToken.real_sol_reserves,
        real_token_reserves: updatedToken.real_token_reserves,
        graduated: updatedToken.graduated,
        volume_24h: updatedToken.volume_24h,
      } : null);
      // Also refresh on-chain stats
      fetchOnChainStats();
    });
    
    return () => {
      unsubscribeChannel(tokenChannel);
    };
  }, [mint]);

  // Refetch holders when token loads (to pass creator for labeling)
  useEffect(() => {
    if (token?.mint) {
      fetchHolders(token.creator || undefined);
    }
  }, [token?.mint, token?.creator, fetchHolders]);

  // Fetch creator's username from user_profiles
  useEffect(() => {
    if (token?.creator) {
      fetch(`/api/user/profile?wallet=${token.creator}`)
        .then(res => res.json())
        .then(data => {
          if (data.username) {
            setCreatorUsername(data.username);
          }
        })
        .catch(() => {});
    }
  }, [token?.creator]);

  const fetchOnChainStats = async () => {
    try {
      const res = await fetch(`/api/stats?mint=${mint}`);
      const data = await res.json();
      if (data.success && data.onChain) {
        setOnChainStats({
          marketCap: data.onChain.marketCap,
          marketCapUsd: data.onChain.marketCapUsd,
          price: data.onChain.price,
          priceUsd: data.onChain.priceUsd,
          solPriceUsd: data.onChain.solPriceUsd,
          bondingCurveSol: data.onChain.bondingCurveSol,
        });
      }
    } catch (err) {
      console.warn('On-chain stats fetch failed');
    }
  };

  const fetchNetworkMode = async () => {
    try {
      const res = await fetch('/api/network');
      const data = await res.json();
      setAnchorAvailable(data.anchorProgram === true);
    } catch (err) {
      console.warn('Network check failed');
      setAnchorAvailable(false);
    }
  };

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

  // Standalone trades fetch for polling
  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch(`/api/trades?mint=${mint}&limit=50`);
      const data = await res.json();
      if (data.success && data.trades) {
        setTrades(data.trades);
      }
    } catch (err) {
      console.warn('Trades fetch failed');
    }
  }, [mint]);

  // Update page title when token loads
  useEffect(() => {
    if (token) {
      document.title = `$${token.symbol} - ${token.name} | ClawdVault`;
    }
    return () => {
      document.title = 'ClawdVault 🦞 | Token Launchpad for AI Agents';
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
      const solOutRaw = token.virtual_sol_reserves - newSolReserves;
      // Cap at real_sol_reserves (can't withdraw more than was deposited)
      const solOut = Math.min(solOutRaw, token.real_sol_reserves || 0);
      const cappedByLiquidity = solOutRaw > (token.real_sol_reserves || 0);
      return { tokens: null, sol: solOut, cappedByLiquidity };
    }
  }, [token, amount, tradeType]);

  // Calculate price impact using current price from candles
  const priceImpact = useMemo(() => {
    const price = currentPrice?.sol ?? onChainStats?.price ?? 0;
    if (!token || !amount || parseFloat(amount) <= 0 || price <= 0) return 0;
    const inputAmount = parseFloat(amount);

    if (tradeType === 'buy') {
      const expectedTokens = inputAmount / price;
      const actualTokens = estimatedOutput?.tokens || 0;
      return ((expectedTokens - actualTokens) / expectedTokens) * 100;
    } else {
      const expectedSol = inputAmount * price;
      const actualSol = estimatedOutput?.sol || 0;
      return ((expectedSol - actualSol) / expectedSol) * 100;
    }
  }, [token, amount, tradeType, estimatedOutput, currentPrice?.sol, onChainStats?.price]);

  // Contract now caps sells at available liquidity, so max is just token balance
  const maxSellableTokens = tokenBalance;

  const handleTrade = async () => {
    if (!amount || !token || !connected || !publicKey) return;
    
    // Wait for network check to complete
    if (anchorAvailable === null) {
      setTradeResult({ success: false, error: 'Loading network status...' });
      return;
    }
    
    // Require Anchor program for non-graduated tokens
    if (!anchorAvailable && !token.graduated) {
      setTradeResult({ success: false, error: 'Anchor program not deployed - cannot trade on bonding curve' });
      return;
    }
    
    setTrading(true);
    setTradeResult(null);

    try {
      console.log('Trade initiated:', { anchorAvailable, tradeType, amount: parseFloat(amount) });
      
      // On-chain trading via Anchor (bonding curve) or Jupiter (graduated)
      console.log('Starting ON-CHAIN trade...');
      
      // Check if token is graduated - use Jupiter instead
      if (token.graduated) {
        console.log('Token graduated, using Jupiter...');
        
        // Convert amount to proper units
        const amountUnits = tradeType === 'buy' 
          ? Math.floor(parseFloat(amount) * 1e9).toString()  // SOL to lamports
          : Math.floor(parseFloat(amount) * 1e6).toString(); // Tokens to units
        
        const jupiterRes = await fetch('/api/trade/jupiter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mint: token.mint,
            action: tradeType,
            amount: amountUnits,
            userPublicKey: publicKey,
            slippageBps: 100, // 1%
          }),
        });

        const jupiterData = await jupiterRes.json();
        
        if (!jupiterData.success) {
          console.error('Jupiter quote failed:', jupiterData);
          setTradeResult({ success: false, error: jupiterData.error || 'Jupiter swap failed' });
          return;
        }
        
        console.log('Jupiter quote received:', jupiterData.quote);
        
        // Sign the Jupiter versioned transaction
        const signedTx = await signTransaction(jupiterData.transaction);
        
        if (!signedTx) {
          setTradeResult({ success: false, error: 'Transaction signing cancelled' });
          return;
        }
        
        console.log('Transaction signed, executing via API...');
        
        // Calculate amounts from quote for DB recording
        const solAmountDecimal = tradeType === 'buy' 
          ? Number(jupiterData.quote.inAmount) / 1e9
          : Number(jupiterData.quote.outAmount) / 1e9;
        const tokenAmountDecimal = tradeType === 'buy'
          ? Number(jupiterData.quote.outAmount) / 1e6
          : Number(jupiterData.quote.inAmount) / 1e6;
        
        // Execute via our API (sends to Solana + records in DB)
        const executeRes = await fetch('/api/trade/jupiter/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mint: token.mint,
            signedTransaction: signedTx,
            type: tradeType,
            wallet: publicKey,
            solAmount: solAmountDecimal,
            tokenAmount: tokenAmountDecimal,
          }),
        });
        
        const executeData = await executeRes.json();
        
        if (!executeData.success) {
          setTradeResult({ success: false, error: executeData.error || 'Jupiter trade failed' });
          return;
        }
        
        console.log('Jupiter trade executed:', executeData.signature);
        
        setTradeResult({
          success: true,
          signature: executeData.signature,
          trade: executeData.trade,
          message: 'Trade executed via Jupiter!',
        });
        setAmount('');
        fetchToken(); fetchOnChainStats(); refreshBalancesAfterTrade();
        setChartKey(k => k + 1);
        return;
      }
      
      // Step 1: Prepare unsigned transaction (bonding curve)
      const prepareRes = await fetch('/api/trade/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mint: token.mint,
          type: tradeType,
          amount: parseFloat(amount),
          wallet: publicKey,
          slippage: 0.01, // 1%
        }),
      });

      const prepareData = await prepareRes.json();
      
      if (!prepareData.success) {
        // Check if graduated redirect
        if (prepareData.graduated) {
          // Re-fetch token to update state, then retry will use Jupiter
          await fetchToken();
          setTradeResult({ success: false, error: 'Token just graduated! Please retry to trade via Raydium.' });
          return;
        }
        console.error('Prepare failed:', prepareData);
        setTradeResult({ success: false, error: prepareData.error || 'Failed to prepare transaction' });
        return;
      }
      console.log('Prepare succeeded:', prepareData);

      console.log('Transaction prepared, requesting signature...');

      // Step 2: User signs with wallet
      const signedTx = await signTransaction(prepareData.transaction);
      
      if (!signedTx) {
        console.error('Signing failed or cancelled');
        setTradeResult({ success: false, error: 'Transaction signing cancelled or failed' });
        return;
      }
      console.log('Transaction signed successfully');

      console.log('Transaction signed, executing...');

      // Step 3: Execute signed transaction
      const executeRes = await fetch('/api/trade/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mint: token.mint,
          type: tradeType,
          signedTransaction: signedTx,
          wallet: publicKey,
          expectedOutput: tradeType === 'buy' ? prepareData.output.tokens : prepareData.output.sol,
          solAmount: tradeType === 'buy' ? prepareData.input.sol : prepareData.output.sol,
          tokenAmount: tradeType === 'sell' ? prepareData.input.tokens : prepareData.output.tokens,
        }),
      });

      const executeData = await executeRes.json();
      
      if (executeData.success) {
        setTradeResult({
          success: true,
          trade: executeData.trade,
          newPrice: executeData.newPrice,
          fees: executeData.fees,
          signature: executeData.signature,
        });
        setAmount('');
        fetchToken(); fetchHolders(token?.creator); fetchOnChainStats();
        refreshBalancesAfterTrade();
        setChartKey(k => k + 1); // Force chart refresh
      } else {
        setTradeResult({ success: false, error: executeData.error || 'Trade execution failed' });
      }
      
    } catch (err) {
      console.error('Trade error:', err);
      setTradeResult({ success: false, error: err instanceof Error ? err.message : 'Network error' });
    } finally {
      setTrading(false);
    }
  };

  const handleQuickSell = (percent: number) => {
    const tokenAmount = (tokenBalance * percent / 100);
    setAmount(tokenAmount.toString());
  };

  const formatPrice = (price: number) => {
    if (price < 0.0000000001) return '<0.0000000001';
    if (price < 0.000001) return price.toFixed(12);
    if (price < 0.001) return price.toFixed(9);
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
    if (n >= 1) return '$' + n.toFixed(2);
    if (n >= 0.01) return '$' + n.toFixed(4);
    if (n >= 0.0001) return '$' + n.toFixed(6);
    if (n >= 0.000001) return '$' + n.toFixed(8);
    return '$' + n.toFixed(10);
  };

  const formatSol = (n: number) => {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M SOL';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K SOL';
    return n.toFixed(2) + ' SOL';
  };

  const formatSolOutput = (n: number) => {
    if (n === 0) return '0 SOL';
    if (n >= 1) return n.toFixed(4) + ' SOL';
    if (n >= 0.0001) return n.toFixed(6) + ' SOL';
    if (n >= 0.0000001) return n.toFixed(9) + ' SOL';
    return n.toExponential(4) + ' SOL';
  };

  const formatValue = (solAmount: number) => {
    if (onChainStats?.solPriceUsd) {
      return formatUsd(solAmount * onChainStats.solPriceUsd);
    }
    return formatSol(solAmount);
  };

  // Calculate graduation market cap from bonding curve
  const graduationMarketCap = useMemo(() => {
    const GRADUATION_SOL = 120;
    const INITIAL_VIRTUAL_SOL = 30;
    const INITIAL_VIRTUAL_TOKENS = 1_073_000_000;
    const TOTAL_SUPPLY = 1_000_000_000;
    
    const k = INITIAL_VIRTUAL_SOL * INITIAL_VIRTUAL_TOKENS;
    const gradVirtualSol = INITIAL_VIRTUAL_SOL + GRADUATION_SOL;
    const gradVirtualTokens = k / gradVirtualSol;
    const gradPrice = gradVirtualSol / gradVirtualTokens;
    const mcapSol = gradPrice * TOTAL_SUPPLY;
    
    return {
      sol: mcapSol,
      usd: solPrice !== null ? mcapSol * solPrice : null,
    };
  }, [solPrice]);

  // Calculate graduation progress from token's real_sol_reserves (updated via realtime)
  const fundsRaised = useMemo(() => {
    return token?.real_sol_reserves || 0;
  }, [token?.real_sol_reserves]);

  const progressPercent = token?.graduated ? 100 : Math.min((fundsRaised / 120) * 100, 100);

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
          {/* Token Header - Compact on desktop */}
          <div className="flex items-start gap-4 mb-6">
            <div className="w-14 h-14 lg:w-16 lg:h-16 bg-gray-700 rounded-full flex items-center justify-center text-3xl flex-shrink-0">
              {token.image ? (
                <img src={token.image} alt="" className="w-full h-full rounded-full object-cover" />
              ) : (
                '🪙'
              )}
            </div>
            <div className="flex-1 min-w-0">
              {/* Row 1: Symbol, Name, Badge */}
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl lg:text-3xl font-bold text-white">${token.symbol}</h1>
                <span className="text-gray-400 text-lg">{token.name}</span>
                {token.graduated && (
                  <span className="bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full text-xs">
                    🎓 Graduated
                  </span>
                )}
              </div>
              
              {/* Row 2: Creator, CA, Socials - all inline on desktop */}
              <div className="flex items-center gap-4 flex-wrap mt-1 text-sm">
                <span className="text-gray-500">
                  by {creatorUsername ? (
                    <ExplorerLink address={token.creator} label={creatorUsername} />
                  ) : (
                    <ExplorerLink address={token.creator} />
                  )}
                </span>
                <span className="text-gray-600 hidden sm:inline">•</span>
                <span className="flex items-center gap-1">
                  <span className="text-gray-500">CA:</span>
                  <a
                    href={`https://solscan.io/account/${token.mint}${process.env.NEXT_PUBLIC_SOLANA_NETWORK === 'mainnet-beta' ? '' : '?cluster=' + (process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-orange-400 hover:text-orange-300"
                    title={token.mint}
                  >
                    {token.mint.slice(0, 6)}...{token.mint.slice(-4)}
                  </a>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(token.mint);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="text-gray-400 hover:text-white transition"
                    title="Copy mint address"
                  >
                    {copied ? '✅' : '📋'}
                  </button>
                </span>
                {/* Social Links - inline */}
                {(token.twitter || token.telegram || token.website) && (
                  <>
                    <span className="text-gray-600 hidden sm:inline">•</span>
                    <div className="flex items-center gap-2">
                      {token.twitter && (
                        <a
                          href={token.twitter.startsWith('http') ? token.twitter : `https://twitter.com/${token.twitter.replace('@', '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gray-400 hover:text-white transition"
                          title="Twitter"
                        >𝕏</a>
                      )}
                      {token.telegram && (
                        <a
                          href={token.telegram.startsWith('http') ? token.telegram : `https://t.me/${token.telegram.replace('@', '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gray-400 hover:text-white transition"
                          title="Telegram"
                        >✈️</a>
                      )}
                      {token.website && (
                        <a
                          href={token.website.startsWith('http') ? token.website : `https://${token.website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gray-400 hover:text-white transition"
                          title="Website"
                        >🌐</a>
                      )}
                    </div>
                  </>
                )}
              </div>
              
              {/* Description - only if present, compact */}
              {token.description && (
                <p className="text-gray-500 text-sm mt-1 line-clamp-2">{token.description}</p>
              )}
            </div>
          </div>

          <div className="flex flex-col lg:grid lg:grid-cols-3 gap-4 w-full min-w-0">
            {/* MOBILE ORDER: Chart (1), Bonding (2), Trade (3), Holders (4), Chat (5) */}
            {/* DESKTOP: Left col (Chart + Chat), Right col (Trade + Bonding + Holders) */}
            
            {/* Chart - order-1 mobile, spans 2 cols on desktop */}
            <div className="order-1 lg:order-none lg:col-span-2 min-w-0">
              <PriceChart 
                key={chartKey}
                mint={token.mint} 
                height={500}
                currentMarketCap={onChainStats?.marketCapUsd ?? 0}
                marketCapSol={onChainStats?.marketCap ?? 0}
                marketCapUsd={onChainStats?.marketCapUsd ?? null}
                volume24h={token.volume_24h || 0}
                holders={holders.length > 0 ? holders.length : (token.holders || 0)}
                onMarketCapUpdate={setCandleMarketCap}
              />
            </div>

            {/* Bonding Curve - order-2 mobile, hidden on desktop (shown in sidebar) */}
            <div className="order-2 lg:hidden bg-gray-800/50 rounded-xl p-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-white font-semibold">Bonding Curve Progress</span>
                <span className="text-orange-400 font-mono font-bold">{progressPercent.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden mb-2">
                <div 
                  className="h-full bg-orange-400 transition-all duration-500"
                  style={{ width: `${Math.min(progressPercent, 100)}%` }}
                />
              </div>
              <div className="text-sm">
                {token.graduated ? (
                  <span className="text-green-400">Coin has graduated!</span>
                ) : (
                  <span className="text-gray-500">{fundsRaised.toFixed(2)} / 120 SOL raised</span>
                )}
              </div>
            </div>

            {/* Holder Distribution - order-5 mobile only (desktop in sidebar) */}
            <div className="order-5 lg:hidden bg-gray-800/50 rounded-xl p-5">
                <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                  <span>👥</span> Holder Distribution
                </h3>
                {holdersLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div key={i} className="flex items-center gap-3 animate-pulse">
                        <div className="w-8 h-8 rounded-full bg-gray-700" />
                        <div className="flex-1">
                          <div className="h-4 bg-gray-700 rounded w-24 mb-1" />
                          <div className="h-3 bg-gray-700 rounded w-16" />
                        </div>
                        <div className="h-2 bg-gray-700 rounded w-16" />
                      </div>
                    ))}
                  </div>
                ) : holders.length === 0 ? (
                  <div className="text-gray-500 text-center py-4 text-sm">No holder data available</div>
                ) : (
                  <div className="space-y-3">
                    {holders.slice(0, 5).map((holder, i) => (
                      <div key={holder.address} className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-400">
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          {holder.label ? (
                            <a
                              href={`https://solscan.io/account/${holder.address}${process.env.NEXT_PUBLIC_SOLANA_NETWORK === 'mainnet-beta' ? '' : '?cluster=' + (process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet')}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`font-medium text-sm hover:underline ${
                                holder.label === 'Liquidity Pool' ? 'text-orange-400' : 'text-blue-400'
                              }`}
                            >{holder.label}</a>
                          ) : (
                            <a
                              href={`https://solscan.io/account/${holder.address}${process.env.NEXT_PUBLIC_SOLANA_NETWORK === 'mainnet-beta' ? '' : '?cluster=' + (process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet')}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gray-300 hover:text-cyan-400 font-mono text-sm truncate hover:underline"
                            >
                              {holder.address.slice(0, 6)}...{holder.address.slice(-4)}
                            </a>
                          )}
                          <div className="text-gray-500 text-xs">{formatNumber(holder.balance)} tokens</div>
                        </div>
                        <div className="text-right">
                          <div 
                            className="h-2 rounded-full bg-gray-700 w-16 overflow-hidden"
                            title={`${holder.percentage.toFixed(2)}%`}
                          >
                            <div 
                              className={`h-full rounded-full ${
                                holder.label === 'Liquidity Pool' ? 'bg-orange-500' : 
                                holder.label === 'Creator (dev)' ? 'bg-blue-500' : 'bg-purple-500'
                              }`}
                              style={{ width: `${Math.min(holder.percentage, 100)}%` }}
                            />
                          </div>
                          <div className="text-gray-400 text-xs mt-1 font-mono">{holder.percentage < 0.1 ? holder.percentage.toFixed(3) : holder.percentage.toFixed(1)}%</div>
                        </div>
                      </div>
                    ))}
                    
                    {circulatingSupply > 0 && (
                      <div className="pt-3 mt-3 border-t border-gray-700/50">
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-gray-500">Circulating</span>
                          <span className="text-white font-mono">{formatNumber(circulatingSupply)}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm mt-1">
                          <span className="text-gray-500">Total Supply</span>
                          <span className="text-gray-400 font-mono">1,000,000,000</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

            {/* Chat - order-4 mobile, spans 2 cols on desktop */}
            <div className="order-4 lg:order-none lg:col-span-2">
              <ChatAndTrades 
                mint={token.mint} 
                tokenSymbol={token.symbol} 
                trades={trades}
                onTradesUpdate={fetchTrades}
              />
            </div>

            {/* Trade Panel - order-3 mobile, in sidebar on desktop (col-3, row-start-1) */}
            <div className="order-3 lg:order-none lg:row-span-3 lg:row-start-1 lg:col-start-3 space-y-4">
              {/* Trade Panel */}
              <div className="bg-gray-800/50 rounded-xl p-6 h-fit lg:sticky lg:top-6">
              <h3 className="text-white font-semibold mb-4">Trade</h3>

              {/* Token Price from last trade (streamed realtime) */}
              <div className="bg-gray-700/50 rounded-lg p-3 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Price</span>
                  <span className="text-white font-mono">
                    {currentPrice?.sol ? formatPrice(currentPrice.sol) : (onChainStats?.price ? formatPrice(onChainStats.price) : '--')} SOL
                  </span>
                </div>
                {(currentPrice?.usd || onChainStats?.priceUsd) && (
                  <div className="flex justify-between text-sm mt-1">
                    <span className="text-gray-400">USD</span>
                    <span className="text-green-400 font-mono">
                      ${(currentPrice?.usd ?? onChainStats?.priceUsd ?? 0).toFixed((currentPrice?.usd ?? onChainStats?.priceUsd ?? 0) < 0.01 ? 8 : 4)}
                    </span>
                  </div>
                )}
              </div>

              {/* User Balance - show if connected */}
                  {connected && (
                    <div className="bg-gray-700/50 rounded-lg p-3 mb-4">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Your SOL</span>
                        <span className="text-white font-mono">
                          {solBalance !== null ? solBalance.toFixed(4) : '--'}
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
                            : formatSolOutput(estimatedOutput.sol || 0)
                          }
                        </span>
                      </div>
                      <div className="flex justify-between text-sm mt-1">
                        <span className="text-gray-400">Price Impact</span>
                        <span className={`font-mono ${
                          tradeType === 'sell' ? 'text-red-400' :
                          priceImpact > 5 ? 'text-red-400' : 
                          priceImpact > 2 ? 'text-yellow-400' : 
                          'text-green-400'
                        }`}>
                          {tradeType === 'sell' ? '-' : ''}{priceImpact.toFixed(2)}%
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

                  {/* Liquidity Info */}
                  {estimatedOutput?.cappedByLiquidity && (
                    <div className="bg-blue-900/30 border border-blue-500/50 rounded-lg p-3 mb-4">
                      <div className="text-blue-400 text-sm flex items-center gap-2">
                        <span>ℹ️</span>
                        <span>Partial fill - only tokens up to available liquidity will be sold.</span>
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
                    {token.graduated 
                      ? "Trades via Raydium • ~0.25% swap fee" 
                      : "1% fee (0.5% creator + 0.5% protocol)"}
                  </div>
              </div>

              {/* Bonding Curve Progress - in sidebar (desktop only) */}
              <div className="hidden lg:block bg-gray-800/50 rounded-xl p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-white font-semibold">Bonding Curve Progress</span>
                  <span className="text-orange-400 font-mono font-bold">{progressPercent.toFixed(1)}%</span>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden mb-2">
                  <div 
                    className="h-full bg-orange-400 transition-all duration-500"
                    style={{ width: `${Math.min(progressPercent, 100)}%` }}
                  />
                </div>
                <div className="text-sm">
                  {token.graduated ? (
                    <span className="text-green-400">Coin has graduated!</span>
                  ) : (
                    <span className="text-gray-500">{fundsRaised.toFixed(2)} / 120 SOL raised</span>
                  )}
                </div>
              </div>

              {/* Holder Distribution - in sidebar on desktop */}
              <div className="bg-gray-800/50 rounded-xl p-5 hidden lg:block">
                <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                  <span>👥</span> Holder Distribution
                </h3>
                {holdersLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div key={i} className="flex items-center gap-3 animate-pulse">
                        <div className="w-8 h-8 rounded-full bg-gray-700" />
                        <div className="flex-1">
                          <div className="h-4 bg-gray-700 rounded w-24 mb-1" />
                          <div className="h-3 bg-gray-700 rounded w-16" />
                        </div>
                        <div className="h-2 bg-gray-700 rounded w-16" />
                      </div>
                    ))}
                  </div>
                ) : holders.length === 0 ? (
                  <div className="text-gray-500 text-center py-4 text-sm">No holder data available</div>
                ) : (
                  <div className="space-y-3">
                    {holders.slice(0, 5).map((holder, i) => (
                      <div key={holder.address} className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-400">
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          {holder.label ? (
                            <a
                              href={`https://solscan.io/account/${holder.address}${process.env.NEXT_PUBLIC_SOLANA_NETWORK === 'mainnet-beta' ? '' : '?cluster=' + (process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet')}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`font-medium text-sm hover:underline ${
                                holder.label === 'Liquidity Pool' ? 'text-orange-400' : 'text-blue-400'
                              }`}
                            >{holder.label}</a>
                          ) : (
                            <a
                              href={`https://solscan.io/account/${holder.address}${process.env.NEXT_PUBLIC_SOLANA_NETWORK === 'mainnet-beta' ? '' : '?cluster=' + (process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet')}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gray-300 hover:text-cyan-400 font-mono text-sm truncate hover:underline"
                            >
                              {holder.address.slice(0, 6)}...{holder.address.slice(-4)}
                            </a>
                          )}
                          <div className="text-gray-500 text-xs">{formatNumber(holder.balance)} tokens</div>
                        </div>
                        <div className="text-right">
                          <div 
                            className="h-2 rounded-full bg-gray-700 w-16 overflow-hidden"
                            title={`${holder.percentage.toFixed(2)}%`}
                          >
                            <div 
                              className={`h-full rounded-full ${
                                holder.label === 'Liquidity Pool' ? 'bg-orange-500' : 
                                holder.label === 'Creator (dev)' ? 'bg-blue-500' : 'bg-purple-500'
                              }`}
                              style={{ width: `${Math.min(holder.percentage, 100)}%` }}
                            />
                          </div>
                          <div className="text-gray-400 text-xs mt-1 font-mono">{holder.percentage < 0.1 ? holder.percentage.toFixed(3) : holder.percentage.toFixed(1)}%</div>
                        </div>
                      </div>
                    ))}
                    
                    {/* Circulating Supply Footer */}
                    {circulatingSupply > 0 && (
                      <div className="pt-3 mt-3 border-t border-gray-700/50">
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-gray-500">Circulating</span>
                          <span className="text-white font-mono">{formatNumber(circulatingSupply)}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm mt-1">
                          <span className="text-gray-500">Total Supply</span>
                          <span className="text-gray-400 font-mono">1,000,000,000</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

          </div>
        </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
