'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, LineData, CandlestickData, ColorType, CandlestickSeries, LineSeries } from 'lightweight-charts';
import { subscribeToCandles, unsubscribeChannel } from '@/lib/supabase-client';

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface PriceChartProps {
  mint: string;
  height?: number;
  totalSupply?: number;
  // Live stats from parent
  currentMarketCap?: number;
  marketCapSol?: number;
  marketCapUsd?: number | null;
  volume24h?: number;
  holders?: number;
  // Callback when market cap updates (source of truth)
  onMarketCapUpdate?: (marketCap: number) => void;
}

type ChartType = 'line' | 'candle';
type Interval = '1m' | '5m' | '15m' | '1h' | '1d';

const TOTAL_SUPPLY = 1_000_000_000;

export default function PriceChart({ 
  mint, 
  height = 400, 
  totalSupply = TOTAL_SUPPLY,
  currentMarketCap = 0,
  marketCapSol = 0,
  marketCapUsd = null,
  volume24h = 0,
  holders = 0,
  onMarketCapUpdate,
}: PriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | ISeriesApi<'Candlestick'> | null>(null);
  
  const [candles, setCandles] = useState<Candle[]>([]);
  const [candles24h, setCandles24h] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartType, setChartType] = useState<ChartType>('candle');
  const [timeInterval, setTimeInterval] = useState<Interval>('5m');

  // Calculate price change from first open to last close (24h candles preferred)
  const priceChange24h = useMemo(() => {
    // Use 24h candles if available (1h interval data)
    const candlesToUse = candles24h.length > 0 ? candles24h : candles;
    
    if (candlesToUse.length === 0) return 0;
    
    // First candle's OPEN vs last candle's CLOSE
    const firstOpen = candlesToUse[0].open;
    const lastClose = candlesToUse[candlesToUse.length - 1].close;
    
    if (firstOpen === 0) return 0;
    
    return ((lastClose - firstOpen) / firstOpen) * 100;
  }, [candles24h, candles]);

  // Calculate current market cap from last candle close (candles are USD price)
  const candleMarketCap = useMemo(() => {
    const candlesToUse = candles.length > 0 ? candles : candles24h;
    if (candlesToUse.length === 0) return null;
    
    const lastClose = candlesToUse[candlesToUse.length - 1].close;
    // Candles are USD price per token, multiply by supply for market cap
    const mcapUsd = lastClose * totalSupply;
    
    return { usd: mcapUsd };
  }, [candles, candles24h, totalSupply]);

  // Calculate ATH and OHLCV from visible candles (candles are USD price)
  const { athPrice, athTime, ohlcv } = useMemo(() => {
    // Find ATH from all candle highs (use 24h candles for broader view)
    // Candles contain USD price per token
    const allCandles = candles24h.length > candles.length ? candles24h : candles;
    let maxPrice = 0;
    let maxTime: number | null = null;
    
    allCandles.forEach(c => {
      if (c.high > maxPrice) {
        maxPrice = c.high;
        maxTime = c.time;
      }
    });
    
    // If no candles, use current market cap as fallback (convert back to price)
    if (maxPrice === 0 && currentMarketCap > 0) {
      maxPrice = currentMarketCap / totalSupply;
    }
    
    // OHLCV for the visible range (last candle)
    if (candles.length === 0) {
      return { athPrice: maxPrice, athTime: maxTime, ohlcv: null };
    }
    
    const last = candles[candles.length - 1];
    const totalVolume = candles.reduce((sum, c) => sum + c.volume, 0);
    
    return {
      athPrice: maxPrice,
      athTime: maxTime,
      ohlcv: {
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
        volume: totalVolume,
      }
    };
  }, [candles, candles24h, currentMarketCap, totalSupply]);

  // Effective market cap: last candle close * totalSupply (in USD)
  const effectiveMarketCap = useMemo(() => {
    if (candles.length > 0) {
      return candles[candles.length - 1].close * totalSupply;
    }
    return 0; // No candles = no market cap yet
  }, [candles, totalSupply]);

  // Notify parent when market cap updates (candles = source of truth)
  useEffect(() => {
    if (effectiveMarketCap > 0 && onMarketCapUpdate) {
      onMarketCapUpdate(effectiveMarketCap);
    }
  }, [effectiveMarketCap, onMarketCapUpdate]);

  // Calculate ATH progress (how close current market cap is to ATH market cap)
  const athMarketCap = athPrice > 0 ? athPrice * totalSupply : 0;
  const athProgress = athMarketCap > 0 ? (effectiveMarketCap / athMarketCap) * 100 : 100;

  // Fetch candles function (reusable)
  const fetchCandles = useCallback(async () => {
    try {
      // Fetch USD candles directly from API
      const res = await fetch(`/api/candles?mint=${mint}&interval=${timeInterval}&limit=200&currency=usd`);
      const data = await res.json();
      setCandles(data.candles?.length > 0 ? data.candles : []);
    } catch (err) {
      console.error('Failed to fetch candles:', err);
      setCandles([]);
    }
  }, [mint, timeInterval]);

  const fetch24hCandles = useCallback(async () => {
    try {
      // Fetch USD candles for 24h view
      const res = await fetch(`/api/candles?mint=${mint}&interval=1h&limit=30&currency=usd`);
      const data = await res.json();
      setCandles24h(data.candles?.length > 0 ? data.candles : []);
    } catch (err) {
      console.error('Failed to fetch 24h candles:', err);
    }
  }, [mint]);

  // Initial fetch and realtime subscription for candles
  useEffect(() => {
    setLoading(true);
    fetchCandles().finally(() => setLoading(false));
    fetch24hCandles();

    // Subscribe to realtime candle updates
    const candleChannel = subscribeToCandles(mint, () => {
      console.log('[PriceChart] Candle update received, refetching...');
      fetchCandles();
      fetch24hCandles();
    });

    // Polling disabled for now - testing realtime only
    // const refreshInterval = window.setInterval(() => {
    //   fetchCandles();
    //   fetch24hCandles();
    // }, 30000);

    return () => {
      // window.clearInterval(refreshInterval);
      unsubscribeChannel(candleChannel);
    };
  }, [mint, timeInterval, fetchCandles, fetch24hCandles]);

  // Create/update chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Format price axis values (e.g., 3.2K instead of 3200)
    const formatAxisPrice = (price: number): string => {
      if (price >= 1000000) return '$' + (price / 1000000).toFixed(1) + 'M';
      if (price >= 1000) return '$' + (price / 1000).toFixed(1) + 'K';
      if (price >= 1) return '$' + price.toFixed(2);
      return '$' + price.toFixed(4);
    };

    if (!chartRef.current) {
      chartRef.current = createChart(chartContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#6b7280',
        },
        grid: {
          vertLines: { color: 'rgba(55, 65, 81, 0.3)' },
          horzLines: { color: 'rgba(55, 65, 81, 0.3)' },
        },
        width: chartContainerRef.current.clientWidth,
        height: height - 160, // Account for header
        crosshair: {
          mode: 1,
          vertLine: { color: '#f97316', width: 1, style: 2 },
          horzLine: { color: '#f97316', width: 1, style: 2 },
        },
        timeScale: {
          borderColor: 'rgba(55, 65, 81, 0.5)',
          timeVisible: true,
          secondsVisible: false,
          barSpacing: 3, // Narrow candles like pump.fun
        },
        rightPriceScale: {
          borderColor: 'rgba(55, 65, 81, 0.5)',
        },
        localization: {
          priceFormatter: formatAxisPrice,
        },
      });
    }

    if (seriesRef.current) {
      chartRef.current.removeSeries(seriesRef.current);
    }

    // Candles are USD price per token from API - convert to market cap for display
    const mcapMultiplier = totalSupply;
    
    if (chartType === 'candle') {
      seriesRef.current = chartRef.current.addSeries(CandlestickSeries, {
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderUpColor: '#22c55e',
        borderDownColor: '#ef4444',
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
        priceScaleId: 'right',
      });
      seriesRef.current.priceScale().applyOptions({
        scaleMargins: { top: 0.1, bottom: 0.3 }, // More room at top for pumps
      });
      
      if (candles.length > 0) {
        const candleData: CandlestickData[] = candles.map(c => ({
          time: c.time as any,
          open: c.open * mcapMultiplier,
          high: c.high * mcapMultiplier,
          low: c.low * mcapMultiplier,
          close: c.close * mcapMultiplier,
        }));
        seriesRef.current.setData(candleData);
      }
    } else {
      seriesRef.current = chartRef.current.addSeries(LineSeries, {
        color: priceChange24h >= 0 ? '#22c55e' : '#ef4444',
        lineWidth: 2,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        priceLineVisible: false,
        priceScaleId: 'right',
      });
      seriesRef.current.priceScale().applyOptions({
        scaleMargins: { top: 0.1, bottom: 0.3 }, // More room at top for pumps
      });
      
      if (candles.length > 0) {
        const lineData: LineData[] = candles.map(c => ({
          time: c.time as any,
          value: c.close * mcapMultiplier,
        }));
        seriesRef.current.setData(lineData);
      }
    }

    // Set visible range based on chart type
    if (candles.length > 0) {
      if (chartType === 'candle') {
        // Candles: narrow bars, first candle in the middle (pump.fun style)
        const totalBars = Math.max(candles.length * 2, 100);
        const halfBars = Math.floor(totalBars / 2);
        chartRef.current.timeScale().setVisibleLogicalRange({
          from: -halfBars,
          to: halfBars,
        });
      } else {
        // Line: fill full width
        chartRef.current.timeScale().fitContent();
      }
    } else {
      chartRef.current.timeScale().fitContent();
    }
  }, [candles, chartType, height, totalSupply, priceChange24h]);

  // Separate resize handling effect - only depends on chart existence
  useEffect(() => {
    const handleResize = () => {
      if (chartRef.current && chartContainerRef.current) {
        const width = chartContainerRef.current.clientWidth;
        if (width > 0) {
          chartRef.current.applyOptions({ width });
        }
      }
    };

    // Initial resize after a small delay to ensure container is measured
    const timeoutId = setTimeout(handleResize, 100);

    // Watch for container size changes
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    
    if (chartContainerRef.current) {
      resizeObserver.observe(chartContainerRef.current);
    }

    // Also listen to window resize
    window.addEventListener('resize', handleResize);
    
    return () => {
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, []);

  // Format helpers
  const formatMcap = (n: number) => {
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(2) + 'M';
    if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
    if (n >= 1) return '$' + n.toFixed(2);
    return '$' + n.toFixed(4);
  };

  const formatMcapSol = (n: number) => {
    if (n >= 1000) return (n / 1000).toFixed(2) + 'K SOL';
    return n.toFixed(2) + ' SOL';
  };

  const formatVolumeUsd = (usdAmount: number) => {
    if (usdAmount >= 1000000) return '$' + (usdAmount / 1000000).toFixed(2) + 'M';
    if (usdAmount >= 1000) return '$' + (usdAmount / 1000).toFixed(2) + 'K';
    return '$' + usdAmount.toFixed(2);
  };

  return (
    <div className="flex flex-col bg-gray-900/80 rounded-xl overflow-hidden border border-gray-700/50 min-w-0">
      {/* Header - pump.fun style market cap + ATH display */}
      <div className="p-4 border-b border-gray-700/30">
        {/* Market Cap Header with ATH progress bar */}
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="text-gray-500 text-xs mb-1">Market Cap</div>
            <div className="text-3xl font-bold text-white">
              {candleMarketCap?.usd ? formatMcap(candleMarketCap.usd) : '--'}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-sm font-medium ${priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {priceChange24h >= 0 ? '+' : ''}
                {candleMarketCap?.usd 
                  ? formatMcap(Math.abs(priceChange24h / 100 * candleMarketCap.usd))
                  : '--'
                } ({priceChange24h >= 0 ? '+' : ''}{priceChange24h.toFixed(2)}%)
              </span>
              <span className="text-gray-500 text-sm">24hr</span>
            </div>
          </div>
          
          {/* ATH Display */}
          <div className="text-right">
            <div className="text-gray-500 text-xs mb-1">ATH</div>
            <div className="text-green-400 font-bold text-xl">
              {athPrice > 0 ? formatMcap(athPrice * totalSupply) : '--'}
            </div>
          </div>
        </div>

        {/* ATH Progress Bar - full width like pump.fun */}
        <div className="mb-4">
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div 
              className={`h-full rounded-full transition-all ${athProgress >= 95 ? 'bg-green-500' : 'bg-gradient-to-r from-gray-600 to-green-500'}`}
              style={{ width: `${Math.min(athProgress, 100)}%` }}
            />
          </div>
        </div>

        {/* OHLCV Bar */}
        {ohlcv && (
          <div className="flex items-center gap-4 text-xs mb-4 flex-wrap">
            <span className="text-gray-500">
              O<span className="text-green-400 ml-1">{formatMcap(ohlcv.open * totalSupply)}</span>
            </span>
            <span className="text-gray-500">
              H<span className="text-green-400 ml-1">{formatMcap(ohlcv.high * totalSupply)}</span>
            </span>
            <span className="text-gray-500">
              L<span className="text-green-400 ml-1">{formatMcap(ohlcv.low * totalSupply)}</span>
            </span>
            <span className="text-gray-500">
              C<span className="text-green-400 ml-1">{formatMcap(ohlcv.close * totalSupply)}</span>
            </span>
            <span className="text-gray-500">
              Vol<span className="text-cyan-400 ml-1">{formatVolumeUsd(ohlcv.volume)}</span>
            </span>
          </div>
        )}

        {/* Controls */}
        <div className="flex justify-between items-center">
          <div className="flex gap-1">
            {(['1m', '5m', '15m', '1h', '1d'] as Interval[]).map((i) => (
              <button
                key={i}
                onClick={() => setTimeInterval(i)}
                className={`px-3 py-1.5 text-xs rounded-md font-medium transition ${
                  timeInterval === i
                    ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/25'
                    : 'bg-gray-800/60 text-gray-400 hover:bg-gray-700 hover:text-gray-300'
                }`}
              >
                {i}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setChartType('line')}
              className={`px-3 py-1.5 text-xs rounded-md font-medium transition ${
                chartType === 'line'
                  ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/25'
                  : 'bg-gray-800/60 text-gray-400 hover:bg-gray-700 hover:text-gray-300'
              }`}
            >
              📈 Line
            </button>
            <button
              onClick={() => setChartType('candle')}
              className={`px-3 py-1.5 text-xs rounded-md font-medium transition ${
                chartType === 'candle'
                  ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/25'
                  : 'bg-gray-800/60 text-gray-400 hover:bg-gray-700 hover:text-gray-300'
              }`}
            >
              🕯️ Candles
            </button>
          </div>
        </div>
      </div>
      
      {/* Chart */}
      {loading && candles.length === 0 ? (
        <div className="flex items-center justify-center text-gray-500" style={{ height: height - 160 }}>
          Loading chart...
        </div>
      ) : candles.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-gray-500" style={{ height: height - 160 }}>
          <span className="text-2xl mb-2">📊</span>
          <span>No price history yet</span>
          <span className="text-xs text-gray-600 mt-1">Chart appears after first trade</span>
        </div>
      ) : (
            <div ref={chartContainerRef} className="w-full dark-scrollbar overflow-hidden" />
      )}
    </div>
  );
}
