'use client';

import { useState, useEffect } from 'react';

export default function MockBanner() {
  const [dismissed, setDismissed] = useState(true); // Start hidden to avoid flash

  useEffect(() => {
    // Check if user has dismissed the banner
    const wasDismissed = localStorage.getItem('mockBannerDismissed');
    if (!wasDismissed) {
      setDismissed(false);
    }
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem('mockBannerDismissed', 'true');
  };

  if (dismissed) return null;

  return (
    <div className="bg-gradient-to-r from-orange-600 to-yellow-500 text-white px-4 py-2.5 text-center text-sm relative">
      <div className="max-w-4xl mx-auto flex items-center justify-center gap-2 flex-wrap">
        <span className="text-lg">🚧</span>
        <span>
          <strong>Preview Mode</strong> — Currently running in mock mode. 
          Real Solana integration coming soon!
        </span>
        <span className="text-lg">🦀</span>
      </div>
      <button
        onClick={handleDismiss}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-white/80 hover:text-white p-1 transition"
        aria-label="Dismiss banner"
      >
        ✕
      </button>
    </div>
  );
}
