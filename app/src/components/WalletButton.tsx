'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useWallet } from '@/contexts/WalletContext';

function shortenAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export default function WalletButton() {
  const { connected, connecting, initializing, publicKey, balance, connect, disconnect } = useWallet();
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
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: publicKey,
          username: newUsername.trim() || null,
        }),
      });
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
        className="bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium transition flex items-center gap-2"
      >
        {connecting ? (
          <>
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Connecting...
          </>
        ) : (
          <>
            <span>👻</span>
            Connect Wallet
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
