'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { authenticatedPost } from '@/lib/signRequest';

// Official Phantom ghost logo
function PhantomIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 180" fill="none">
      <path fillRule="evenodd" clipRule="evenodd" d="M89.1138 112.613C83.1715 121.719 73.2139 133.243 59.9641 133.243C53.7005 133.243 47.6777 130.665 47.6775 119.464C47.677 90.9369 86.6235 46.777 122.76 46.7764C143.317 46.776 151.509 61.0389 151.509 77.2361C151.509 98.0264 138.018 121.799 124.608 121.799C120.352 121.799 118.264 119.462 118.264 115.756C118.264 114.789 118.424 113.741 118.746 112.613C114.168 120.429 105.335 127.683 97.0638 127.683C91.0411 127.683 87.9898 123.895 87.9897 118.576C87.9897 116.642 88.3912 114.628 89.1138 112.613ZM115.936 68.7103C112.665 68.7161 110.435 71.4952 110.442 75.4598C110.449 79.4244 112.689 82.275 115.96 82.2693C119.152 82.2636 121.381 79.4052 121.374 75.4405C121.367 71.4759 119.128 68.7047 115.936 68.7103ZM133.287 68.6914C130.016 68.6972 127.786 71.4763 127.793 75.4409C127.8 79.4055 130.039 82.2561 133.311 82.2504C136.503 82.2448 138.732 79.3863 138.725 75.4216C138.718 71.457 136.479 68.6858 133.287 68.6914Z" fill="currentColor"/>
    </svg>
  );
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export default function WalletButton() {
  const wallet = useWallet();
  const { connected, connecting, initializing, publicKey, balance, connect, disconnect } = wallet;
  const [showDropdown, setShowDropdown] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [editingUsername, setEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch profile when connected
  const fetchProfile = useCallback(async () => {
    if (!publicKey) return;
    try {
      const res = await fetch(`/api/profile?wallet=${publicKey}`);
      const data = await res.json();
      if (data.success && data.profile) {
        setUsername(data.profile.username);
        setNewUsername(data.profile.username || '');
      }
    } catch (err) {
      console.error('Failed to fetch profile:', err);
    }
  }, [publicKey]);

  useEffect(() => {
    if (connected && publicKey) {
      fetchProfile();
    } else {
      setUsername(null);
    }
  }, [connected, publicKey, fetchProfile]);

  // Save username
  const saveUsername = async () => {
    if (!publicKey || savingUsername) return;
    setSavingUsername(true);
    try {
      const profileData = {
        username: newUsername.trim() || null,
        avatar: null,
      };
      const res = await authenticatedPost(wallet, '/api/profile', 'profile', profileData);
      const data = await res.json();
      if (data.success) {
        setUsername(data.profile.username);
        setEditingUsername(false);
      }
    } catch (err) {
      console.error('Failed to save username:', err);
    } finally {
      setSavingUsername(false);
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
        setEditingUsername(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Show skeleton while checking auto-reconnect
  if (initializing) {
    return (
      <div className="bg-gray-800 border border-gray-700 px-4 py-2 rounded-lg animate-pulse flex items-center gap-2">
        <div className="w-4 h-4 bg-gray-600 rounded-full" />
        <div className="w-20 h-4 bg-gray-600 rounded" />
      </div>
    );
  }

  if (!connected) {
    return (
      <button
        onClick={connect}
        disabled={connecting}
        title="Connect your Phantom wallet to trade tokens"
        className="bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium transition flex items-center gap-2 group"
      >
        {connecting ? (
          <>
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            <span>Connecting...</span>
          </>
        ) : (
          <>
            <PhantomIcon className="w-5 h-5 group-hover:scale-110 transition-transform" />
            <span>Connect Wallet</span>
          </>
        )}
      </button>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white px-4 py-2 rounded-lg font-medium transition flex items-center gap-2"
      >
        <div className="w-2 h-2 bg-green-400 rounded-full" />
        <span>{username || shortenAddress(publicKey!)}</span>
        {balance !== null && (
          <span className="text-gray-400 text-sm">
            {balance.toFixed(2)} SOL
          </span>
        )}
        <span className="text-gray-500">▼</span>
      </button>

      {showDropdown && (
        <div className="absolute right-0 mt-2 w-72 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
          {/* Username Section */}
          <div className="p-4 border-b border-gray-700">
            <div className="text-gray-400 text-xs mb-2">Display Name</div>
            {editingUsername ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="Enter username"
                  maxLength={20}
                  className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-white text-sm focus:border-orange-500 focus:outline-none"
                  autoFocus
                />
                <button
                  onClick={saveUsername}
                  disabled={savingUsername}
                  className="bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-sm transition"
                >
                  {savingUsername ? '...' : '✓'}
                </button>
                <button
                  onClick={() => {
                    setEditingUsername(false);
                    setNewUsername(username || '');
                  }}
                  className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded-lg text-sm transition"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-white font-medium">
                  {username || <span className="text-gray-500 italic">Not set</span>}
                </span>
                <button
                  onClick={() => setEditingUsername(true)}
                  className="text-orange-400 hover:text-orange-300 text-sm transition"
                >
                  Edit
                </button>
              </div>
            )}
          </div>

          {/* Wallet Address */}
          <div className="p-4 border-b border-gray-700">
            <div className="text-gray-400 text-xs mb-1">Wallet Address</div>
            <div className="text-white font-mono text-sm break-all">{publicKey}</div>
          </div>
          
          {/* Balance */}
          <div className="p-4 border-b border-gray-700">
            <div className="text-gray-400 text-xs mb-1">Balance</div>
            <div className="text-white text-lg font-semibold">
              {balance !== null ? `${balance.toFixed(4)} SOL` : 'Loading...'}
            </div>
          </div>

          {/* Actions */}
          <div className="p-2">
            <button
              onClick={() => {
                navigator.clipboard.writeText(publicKey!);
                setShowDropdown(false);
              }}
              className="w-full text-left px-3 py-2 text-gray-300 hover:bg-gray-700 rounded-lg transition flex items-center gap-2"
            >
              <span>📋</span>
              Copy Address
            </button>
            <a
              href={`https://solscan.io/account/${publicKey}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full text-left px-3 py-2 text-gray-300 hover:bg-gray-700 rounded-lg transition flex items-center gap-2 block"
              onClick={() => setShowDropdown(false)}
            >
              <span>🔍</span>
              View on Solscan
            </a>
            <button
              onClick={() => {
                disconnect();
                setShowDropdown(false);
              }}
              className="w-full text-left px-3 py-2 text-red-400 hover:bg-gray-700 rounded-lg transition flex items-center gap-2"
            >
              <span>🚪</span>
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
