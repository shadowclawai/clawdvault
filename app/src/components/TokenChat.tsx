'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface ChatMessage {
  id: string;
  sender: string;
  username: string | null;
  avatar: string | null;
  message: string;
  replyTo: string | null;
  createdAt: string;
}

interface UserProfile {
  wallet: string;
  username: string | null;
  avatar: string | null;
  messageCount: number;
}

interface TokenChatProps {
  mint: string;
  tokenSymbol: string;
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function shortenAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export default function TokenChat({ mint, tokenSymbol }: TokenChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [editingUsername, setEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Fetch messages
  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat?mint=${mint}&limit=100`);
      const data = await res.json();
      if (data.success) {
        setMessages(data.messages);
      }
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    } finally {
      setLoading(false);
    }
  }, [mint]);

  // Fetch profile when wallet connects
  const fetchProfile = useCallback(async (wallet: string) => {
    try {
      const res = await fetch(`/api/profile?wallet=${wallet}`);
      const data = await res.json();
      if (data.success && data.profile) {
        setProfile(data.profile);
        setNewUsername(data.profile.username || '');
      }
    } catch (err) {
      console.error('Failed to fetch profile:', err);
    }
  }, []);

  // Initial load and polling
  useEffect(() => {
    fetchMessages();
    
    // Poll for new messages every 5 seconds
    const interval = setInterval(fetchMessages, 5000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Try to connect to Phantom wallet
  const connectWallet = async () => {
    try {
      // @ts-ignore - Phantom types
      const provider = window?.phantom?.solana;
      if (provider?.isPhantom) {
        const response = await provider.connect();
        const wallet = response.publicKey.toString();
        setWalletAddress(wallet);
        fetchProfile(wallet);
      } else {
        setError('Phantom wallet not found');
      }
    } catch (err) {
      console.error('Wallet connection error:', err);
    }
  };

  // Save username
  const saveUsername = async () => {
    if (!walletAddress || savingUsername) return;
    
    setSavingUsername(true);
    setError('');

    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: walletAddress,
          username: newUsername.trim() || null,
        }),
      });

      const data = await res.json();
      
      if (data.success) {
        setProfile(data.profile);
        setEditingUsername(false);
      } else {
        setError(data.error || 'Failed to save');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setSavingUsername(false);
    }
  };

  // Send message
  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || sending || !walletAddress) return;

    setSending(true);
    setError('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mint,
          sender: walletAddress,
          message: newMessage.trim(),
        }),
      });

      const data = await res.json();
      
      if (data.success) {
        setMessages(prev => [...prev, data.message]);
        setNewMessage('');
      } else {
        setError(data.error || 'Failed to send');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setSending(false);
    }
  };

  const getDisplayName = (msg: ChatMessage) => {
    if (msg.username) return msg.username;
    return shortenAddress(msg.sender);
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex flex-col" style={{ height: '420px' }}>
      {/* Header */}
      <div className="bg-gray-800/50 px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">💬</span>
          <span className="font-medium text-white">${tokenSymbol} Chat</span>
          <span className="text-gray-500 text-sm">({messages.length})</span>
        </div>
        {!walletAddress ? (
          <button
            onClick={connectWallet}
            className="text-xs bg-orange-500 hover:bg-orange-400 text-white px-3 py-1.5 rounded-lg transition font-medium"
          >
            Connect to Chat
          </button>
        ) : (
          <div className="flex items-center gap-2">
            {editingUsername ? (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="username"
                  maxLength={20}
                  className="w-24 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:border-orange-500 focus:outline-none"
                />
                <button
                  onClick={saveUsername}
                  disabled={savingUsername}
                  className="text-green-400 hover:text-green-300 text-xs"
                >
                  {savingUsername ? '...' : '✓'}
                </button>
                <button
                  onClick={() => {
                    setEditingUsername(false);
                    setNewUsername(profile?.username || '');
                  }}
                  className="text-gray-400 hover:text-gray-300 text-xs"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                onClick={() => setEditingUsername(true)}
                className="text-xs text-orange-400 hover:text-orange-300 transition"
                title="Edit username"
              >
                {profile?.username || shortenAddress(walletAddress)}
              </button>
            )}
            <span className="text-green-400 text-xs">●</span>
          </div>
        )}
      </div>

      {/* Messages */}
      <div 
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-3"
      >
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="animate-spin w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <div className="text-4xl mb-2">🐺</div>
            <div>No messages yet</div>
            <div className="text-sm">Connect wallet to chat!</div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="group">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span 
                      className={`font-medium text-sm ${
                        msg.username ? 'text-orange-400' : 'text-gray-400'
                      }`}
                      title={msg.sender}
                    >
                      {getDisplayName(msg)}
                    </span>
                    <span className="text-gray-600 text-xs">
                      {formatTimeAgo(new Date(msg.createdAt))}
                    </span>
                  </div>
                  <p className="text-gray-300 text-sm break-words">{msg.message}</p>
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-gray-800">
        {error && (
          <div className="text-red-400 text-xs mb-2">{error}</div>
        )}
        {walletAddress ? (
          <form onSubmit={sendMessage}>
            <div className="flex gap-2">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type a message..."
                maxLength={500}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:border-orange-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!newMessage.trim() || sending}
                className="bg-orange-500 hover:bg-orange-400 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition"
              >
                {sending ? '...' : 'Send'}
              </button>
            </div>
            <div className="text-xs text-gray-500 mt-2">
              {newMessage.length}/500
            </div>
          </form>
        ) : (
          <div className="text-center py-2">
            <button
              onClick={connectWallet}
              className="bg-orange-500 hover:bg-orange-400 text-white px-6 py-2 rounded-lg text-sm font-medium transition"
            >
              Connect Wallet to Chat
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
