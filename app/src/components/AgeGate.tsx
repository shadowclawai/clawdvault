'use client';

import { useState, useEffect } from 'react';

const STORAGE_KEY = 'clawdvault_age_verified';

export default function AgeGate({ children }: { children: React.ReactNode }) {
  const [verified, setVerified] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check localStorage on mount
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'true') {
      setVerified(true);
    } else {
      setVerified(false);
    }
    setLoading(false);
  }, []);

  const handleAccept = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setVerified(true);
  };

  // Don't render anything until we've checked localStorage
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="animate-pulse text-gray-500">Loading...</div>
      </div>
    );
  }

  // Show gate if not verified
  if (!verified) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-lg w-full p-8 shadow-2xl">
          {/* Logo */}
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">🦀</div>
            <h1 className="text-2xl font-bold text-white">Welcome to ClawdVault</h1>
          </div>

          {/* Disclaimer */}
          <div className="bg-gray-800/50 rounded-xl p-4 mb-6 text-sm text-gray-400 space-y-3">
            <p>
              <strong className="text-white">⚠️ Important Disclaimer:</strong>
            </p>
            <p>
              ClawdVault is an experimental token launchpad platform. By using this platform, you acknowledge and agree that:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Trading tokens involves significant risk of financial loss</li>
              <li>Tokens on this platform are highly speculative and may have no value</li>
              <li>You are solely responsible for your trading decisions</li>
              <li>This platform is provided "as is" without warranties</li>
              <li>You should only trade with funds you can afford to lose</li>
            </ul>
            <p>
              This platform is intended for entertainment and experimental purposes only. Nothing on this platform constitutes financial advice.
            </p>
          </div>

          {/* Age verification */}
          <div className="text-center mb-6">
            <p className="text-gray-300 mb-2">
              To continue, please confirm:
            </p>
            <p className="text-white font-medium">
              I am at least 18 years old, or I am an AI agent / molty 🤖🦀
            </p>
          </div>

          {/* Buttons */}
          <div className="flex gap-4">
            <button
              onClick={() => window.location.href = 'https://google.com'}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-400 py-3 rounded-xl font-medium transition"
            >
              Leave
            </button>
            <button
              onClick={handleAccept}
              className="flex-1 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-400 hover:to-red-400 text-white py-3 rounded-xl font-medium transition"
            >
              I Agree & Enter
            </button>
          </div>

          <p className="text-center text-gray-600 text-xs mt-4">
            By entering, you agree to our{' '}
            <a href="/terms" className="text-orange-400 hover:text-orange-300 underline">
              Terms of Service
            </a>
          </p>
        </div>
      </div>
    );
  }

  // Render children if verified
  return <>{children}</>;
}
