'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { createChart, IChartApi, ISeriesApi, LineData, CandlestickData, ColorType } from 'lightweight-charts';

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
  currentPrice?: number;
  marketCapSol?: number;
  marketCapUsd?: number | null;
  volume24h?: number;
  solPrice?: number | null;
  holders?: number;
}

type ChartType = 'line' | 'candle';
type Interval = '1m' | '5m' | '15m' | '1h' | '1d';

const TOTAL_SUPPLY = 1_000_000_000;

export default function PriceChart({ 
  mint, 
  height = 400, 
  totalSupply = TOTAL_SUPPLY,
  currentPrice = 0,
  marketCapSol = 0,
  marketCapUsd = null,
  volume24h = 0,
  solPrice = null,
  holders = 0,
}: PriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | ISeriesApi<'Candlestick'> | null>(null);
  
  const [candles, setCandles] = useState<Candle[]>([]);
  const [candles24h, setCandles24h] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartType, setChartType] = useState<ChartType>('line');
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

  // Calculate ATH and OHLCV from visible candles
  const { athPrice, athTime, ohlcv } = useMemo(() => {
    if (candles.length === 0) {
      return { athPrice: 0, athTime: null, ohlcv: null };
    }
    
    // Find ATH from all candles (use 24h candles for broader view)
    const allCandles = candles24h.length > candles.length ? candles24h : candles;
    let maxPrice = 0;
    let maxTime: number | null = null;
    allCandles.forEach(c => {
      if (c.high > maxPrice) {
        maxPrice = c.high;
        maxTime = c.time;
      }
    });
    
    // OHLCV for the visible range (last candle)
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
  }, [candles, candles24h]);

  // Calculate ATH progress (how close current price is to ATH)
  const athProgress = athPrice > 0 ? (currentPrice / athPrice) * 100 : 100;

  // Fetch candles for chart display
  useEffect(() => {
    const fetchCandles = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/candles?mint=${mint}&interval=${timeInterval}&limit=200`);
        const data = await res.json();
        setCandles(data.candles?.length > 0 ? data.candles : []);
      } catch (err) {
        console.error('Failed to fetch candles:', err);
        setCandles([]);
      } finally {
        setLoading(false);
      }
    };

    fetchCandles();
    const refreshInterval = window.setInterval(fetchCandles, 30000);
    return () => window.clearInterval(refreshInterval);
  }, [mint, timeInterval]);

  // Fetch 24h candles separately for accurate 24h change calculation
  useEffect(() => {
    const fetch24hCandles = async () => {
      try {
        // Fetch 1h candles for past 24+ hours
        const res = await fetch(`/api/candles?mint=${mint}&interval=1h&limit=30`);
        const data = await res.json();
        setCandles24h(data.candles?.length > 0 ? data.candles : []);
      } catch (err) {
        console.error('Failed to fetch 24h candles:', err);
      }
    };

    fetch24hCandles();
    // Refresh 24h data every 5 minutes
    const refreshInterval = window.setInterval(fetch24hCandles, 5 * 60 * 1000);
    return () => window.clearInterval(refreshInterval);
  }, [mint]);

  // Create/update chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

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
        },
        rightPriceScale: {
          borderColor: 'rgba(55, 65, 81, 0.5)',
        },
      });
    }

    if (seriesRef.current) {
      chartRef.current.removeSeries(seriesRef.current);
    }

    if (chartType === 'candle') {
      seriesRef.current = chartRef.current.addCandlestickSeries({
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderUpColor: '#22c55e',
        borderDownColor: '#ef4444',
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
      });
      
      if (candles.length > 0) {
        const candleData: CandlestickData[] = candles.map(c => ({
          time: c.time as any,
          open: c.open * totalSupply,
          high: c.high * totalSupply,
          low: c.low * totalSupply,
          close: c.close * totalSupply,
        }));
        seriesRef.current.setData(candleData);
      }
    } else {
      seriesRef.current = chartRef.current.addLineSeries({
        color: priceChange24h >= 0 ? '#22c55e' : '#ef4444',
        lineWidth: 2,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        priceLineVisible: false,
      });
      
      if (candles.length > 0) {
        const lineData: LineData[] = candles.map(c => ({
          time: c.time as any,
          value: c.close * totalSupply,
        }));
        seriesRef.current.setData(lineData);
      }
    }

    chartRef.current.timeScale().fitContent();

    const handleResize = () => {
      if (chartRef.current && chartContainerRef.current) {
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [candles, chartType, height, totalSupply, priceChange24h]);

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

  const formatVolume = (n: number) => {
    if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(2) + 'K';
    return n.toFixed(2);
  };

  return (
    <div className="bg-gray-900/80 rounded-xl overflow-hidden border border-gray-700/50">
      {/* Header - pump.fun style market cap + ATH display */}
      <div className="p-4 border-b border-gray-700/30">
        {/* Market Cap Header with ATH progress bar */}
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="text-gray-500 text-xs mb-1">Market Cap</div>
            <div className="text-3xl font-bold text-white">
              {marketCapUsd ? formatMcap(marketCapUsd) : formatMcapSol(marketCapSol)}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-sm font-medium ${priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {priceChange24h >= 0 ? '+' : ''}{marketCapUsd 
                  ? formatMcap(Math.abs(priceChange24h / 100 * marketCapUsd))
                  : formatMcapSol(Math.abs(priceChange24h / 100 * marketCapSol))
                } ({priceChange24h >= 0 ? '+' : ''}{priceChange24h.toFixed(2)}%)
              </span>
              <span className="text-gray-500 text-sm">24hr</span>
            </div>
          </div>
          
          {/* ATH Display */}
          <div className="text-right">
            <div className="text-gray-500 text-xs mb-1">ATH</div>
            <div className="text-green-400 font-bold text-xl">
              {marketCapUsd && athPrice > 0
                ? formatMcap(athPrice * totalSupply * (solPrice || 0))
                : athPrice > 0 ? formatMcapSol(athPrice * totalSupply) : '--'
              }
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
              O<span className="text-green-400 ml-1">{formatMcap((ohlcv.open * totalSupply) * (solPrice || 1))}</span>
            </span>
            <span className="text-gray-500">
              H<span className="text-green-400 ml-1">{formatMcap((ohlcv.high * totalSupply) * (solPrice || 1))}</span>
            </span>
            <span className="text-gray-500">
              L<span className="text-green-400 ml-1">{formatMcap((ohlcv.low * totalSupply) * (solPrice || 1))}</span>
            </span>
            <span className="text-gray-500">
              C<span className="text-green-400 ml-1">{formatMcap((ohlcv.close * totalSupply) * (solPrice || 1))}</span>
            </span>
            <span className="text-gray-500">
              Vol<span className="text-cyan-400 ml-1">{formatVolume(ohlcv.volume)}</span>
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
        <div ref={chartContainerRef} className="dark-scrollbar" />
      )}
    </div>
  );
}
