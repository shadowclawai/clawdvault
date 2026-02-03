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
}

type ChartType = 'line' | 'candle';
type Interval = '1m' | '5m' | '15m' | '1h' | '1d';

export default function PriceChart({ mint, height = 300 }: PriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | ISeriesApi<'Candlestick'> | null>(null);
  
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartType, setChartType] = useState<ChartType>('line');
  const [timeInterval, setTimeInterval] = useState<Interval>('5m');

  // Fetch candles
  useEffect(() => {
    const fetchCandles = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/candles?mint=${mint}&interval=${timeInterval}&limit=200`);
        const data = await res.json();
        if (data.candles && data.candles.length > 0) {
          setCandles(data.candles);
        } else {
          setCandles([]);
        }
      } catch (err) {
        console.error('Failed to fetch candles:', err);
        setError('Failed to load chart data');
      } finally {
        setLoading(false);
      }
    };

    fetchCandles();
    
    // Refresh every 30 seconds
    const refreshInterval = setInterval(fetchCandles, 30000);
    return () => clearInterval(refreshInterval);
  }, [mint, timeInterval]);

  // Create/update chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart if it doesn't exist
    if (!chartRef.current) {
      chartRef.current = createChart(chartContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#9ca3af',
        },
        grid: {
          vertLines: { color: 'rgba(75, 85, 99, 0.2)' },
          horzLines: { color: 'rgba(75, 85, 99, 0.2)' },
        },
        width: chartContainerRef.current.clientWidth,
        height: height,
        crosshair: {
          mode: 1,
          vertLine: {
            color: '#f97316',
            width: 1,
            style: 2,
          },
          horzLine: {
            color: '#f97316',
            width: 1,
            style: 2,
          },
        },
        timeScale: {
          borderColor: 'rgba(75, 85, 99, 0.3)',
          timeVisible: true,
          secondsVisible: false,
        },
        rightPriceScale: {
          borderColor: 'rgba(75, 85, 99, 0.3)',
        },
      });
    }

    // Remove old series
    if (seriesRef.current) {
      chartRef.current.removeSeries(seriesRef.current);
    }

    // Add new series based on chart type
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
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }));
        seriesRef.current.setData(candleData);
      }
    } else {
      seriesRef.current = chartRef.current.addLineSeries({
        color: '#f97316',
        lineWidth: 2,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        priceLineVisible: false,
      });
      
      if (candles.length > 0) {
        const lineData: LineData[] = candles.map(c => ({
          time: c.time as any,
          value: c.close,
        }));
        seriesRef.current.setData(lineData);
      }
    }

    // Fit content
    chartRef.current.timeScale().fitContent();

    // Handle resize
    const handleResize = () => {
      if (chartRef.current && chartContainerRef.current) {
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [candles, chartType, height]);

  // Cleanup chart on unmount
  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, []);

  if (loading && candles.length === 0) {
    return (
      <div className="bg-gray-800/50 rounded-xl p-4" style={{ height }}>
        <div className="flex items-center justify-center h-full text-gray-500">
          Loading chart...
        </div>
      </div>
    );
  }

  if (error || candles.length === 0) {
    return (
      <div className="bg-gray-800/50 rounded-xl p-4" style={{ height }}>
        <div className="flex flex-col items-center justify-center h-full text-gray-500">
          <span className="text-2xl mb-2">📊</span>
          <span>No price history yet</span>
          <span className="text-xs text-gray-600 mt-1">Chart will appear after trades</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800/50 rounded-xl p-4">
      {/* Controls */}
      <div className="flex justify-between items-center mb-3">
        <div className="flex gap-1">
          {(['1m', '5m', '15m', '1h', '1d'] as Interval[]).map((i) => (
            <button
              key={i}
              onClick={() => setTimeInterval(i)}
              className={`px-2 py-1 text-xs rounded transition ${
                timeInterval === i
                  ? 'bg-orange-500 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
            >
              {i}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setChartType('line')}
            className={`px-2 py-1 text-xs rounded transition ${
              chartType === 'line'
                ? 'bg-orange-500 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            }`}
          >
            Line
          </button>
          <button
            onClick={() => setChartType('candle')}
            className={`px-2 py-1 text-xs rounded transition ${
              chartType === 'candle'
                ? 'bg-orange-500 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            }`}
          >
            Candles
          </button>
        </div>
      </div>
      
      {/* Chart */}
      <div ref={chartContainerRef} className="dark-scrollbar" />
    </div>
  );
}
