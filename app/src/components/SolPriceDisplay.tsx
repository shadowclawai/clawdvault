'use client';

import { useSolPrice } from '@/hooks/useSolPrice';

interface SolPriceDisplayProps {
  /** Show full details (source, age) or just price */
  detailed?: boolean;
  /** Custom className for styling */
  className?: string;
}

/**
 * Live SOL price display component
 * Automatically updates via Supabase Realtime
 */
export default function SolPriceDisplay({ detailed = false, className = '' }: SolPriceDisplayProps) {
  const { price, source, age, isValid, loading } = useSolPrice({ fetchOnMount: true, realtime: true });
  
  if (loading && !price) {
    return (
      <div className={`flex items-center gap-2 text-gray-400 ${className}`}>
        <span className="text-sm">SOL</span>
        <span className="animate-pulse">...</span>
      </div>
    );
  }
  
  if (!price) {
    return (
      <div className={`flex items-center gap-2 text-gray-500 ${className}`}>
        <span className="text-sm">SOL</span>
        <span className="text-xs">--</span>
      </div>
    );
  }
  
  const formattedPrice = price.toFixed(2);
  const isStale = !isValid;
  
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="text-xs text-gray-400">SOL</span>
      <span className={`font-mono font-medium text-sm ${isStale ? 'text-gray-400' : 'text-green-400'}`}>
        ${formattedPrice}
      </span>
      {isStale && (
        <span className="text-[10px] text-gray-500" title="Price may be stale">
          ⚠️
        </span>
      )}
      {detailed && source && (
        <span className="text-[10px] text-gray-500 hidden sm:inline">
          via {source}
        </span>
      )}
      {detailed && age > 60 && (
        <span className="text-[10px] text-gray-500 hidden sm:inline">
          {Math.floor(age / 60)}m ago
        </span>
      )}
    </div>
  );
}
