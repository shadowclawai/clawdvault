'use client';

import { useEffect, useRef, useState } from 'react';
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
  bondingProgress?: number;
  volume24h?: number;
  solPrice?: number | null;
  holders?: number;
}

type ChartType = 'line' | 'candle';
type Interval = '1m' | '5m' | '15m' | '1h' | '1d';

const TOTAL_SUPPLY = 1_000_000_000;

export default function PriceChart({ 
  mint, 
  height = 450, 
  totalSupply = TOTAL_SUPPLY,
  currentPrice = 0,
  marketCapSol = 0,
  marketCapUsd = null,
  bondingProgress = 0,
  volume24h = 0,
  solPrice = null,
  holders = 0,
}: PriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | ISeriesApi<'Candlestick'> | null>(null);
  
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartType, setChartType] = useState<ChartType>('line');
  const [timeInterval, setTimeInterval] = useState<Interval>('5m');

  // Calculate price change from candles
  const priceChange = candles.length >= 2 
    ? ((candles[candles.length - 1].close - candles[0].close) / candles[0].close) * 100
    : 0;

  // Fetch candles
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
    const refreshInterval = setInterval(fetchCandles, 30000);
    return () => clearInterval(refreshInterval);
  }, [mint, timeInterval]);

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
        height: height - 220, // Account for expanded header
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
        color: priceChange >= 0 ? '#22c55e' : '#ef4444',
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
  }, [candles, chartType, height, totalSupply, priceChange]);

  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, []);

  // Format helpers
  const formatPrice = (price: number) => {
    if (price < 0.0000000001) return '<0.0000000001';
    if (price < 0.000001) return price.toFixed(12);
    if (price < 0.001) return price.toFixed(9);
    return price.toFixed(6);
  };

  const formatUsd = (n: number) => {
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(2) + 'M';
    if (n >= 1000) return '$' + (n / 1000).toFixed(2) + 'K';
    if (n >= 1) return '$' + n.toFixed(2);
    return '$' + n.toFixed(4);
  };

  const formatSol = (n: number) => {
    if (n >= 1000) return (n / 1000).toFixed(2) + 'K';
    return n.toFixed(2);
  };

  return (
    <div className="bg-gray-900/80 rounded-xl overflow-hidden border border-gray-700/50">
      {/* Header Stats - pump.fun style */}
      <div className="p-4 border-b border-gray-700/30">
        {/* Main Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          {/* Price */}
          <div className="bg-gray-800/40 rounded-lg p-3">
            <div className="text-gray-500 text-xs mb-1">Price</div>
            <div className="text-white text-lg font-mono leading-tight">
              {formatPrice(currentPrice)}
            </div>
            <div className="flex items-center gap-2 mt-1">
              {solPrice && (
                <span className="text-gray-500 text-xs">
                  ≈ {formatUsd(currentPrice * solPrice)}
                </span>
              )}
              {priceChange !== 0 && (
                <span className={`text-xs font-medium ${priceChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {priceChange >= 0 ? '▲' : '▼'} {Math.abs(priceChange).toFixed(1)}%
                </span>
              )}
            </div>
          </div>

          {/* Market Cap */}
          <div className="bg-gray-800/40 rounded-lg p-3">
            <div className="text-gray-500 text-xs mb-1">Market Cap</div>
            <div className="text-orange-400 text-lg font-mono leading-tight">
              {marketCapUsd ? formatUsd(marketCapUsd) : formatSol(marketCapSol)}
            </div>
            {marketCapUsd && (
              <div className="text-gray-500 text-xs mt-1">{formatSol(marketCapSol)} SOL</div>
            )}
          </div>

          {/* Volume */}
          <div className="bg-gray-800/40 rounded-lg p-3">
            <div className="text-gray-500 text-xs mb-1">24h Volume</div>
            <div className="text-blue-400 text-lg font-mono leading-tight">
              {solPrice ? formatUsd(volume24h * solPrice) : formatSol(volume24h)}
            </div>
            {solPrice && (
              <div className="text-gray-500 text-xs mt-1">{formatSol(volume24h)} SOL</div>
            )}
          </div>

          {/* Holders */}
          <div className="bg-gray-800/40 rounded-lg p-3">
            <div className="text-gray-500 text-xs mb-1">Holders</div>
            <div className="text-purple-400 text-lg font-mono leading-tight">
              {holders || '--'}
            </div>
          </div>
        </div>

        {/* Bonding Curve Progress */}
        <div className="bg-gray-800/40 rounded-lg p-3 mb-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-gray-400 text-sm">Bonding Curve Progress</span>
            <span className="text-orange-400 font-mono font-medium">{bondingProgress.toFixed(1)}%</span>
          </div>
          <div className="h-2.5 bg-gray-700 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-orange-500 via-orange-400 to-green-400 transition-all duration-500"
              style={{ width: `${Math.min(bondingProgress, 100)}%` }}
            />
          </div>
          <div className="text-gray-500 text-xs mt-2 text-center">
            🚀 Raydium graduation at 100%
          </div>
        </div>

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
        <div className="flex items-center justify-center text-gray-500" style={{ height: height - 220 }}>
          Loading chart...
        </div>
      ) : candles.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-gray-500" style={{ height: height - 220 }}>
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
