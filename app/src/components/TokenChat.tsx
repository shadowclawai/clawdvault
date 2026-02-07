'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { authenticatedPost, authenticatedDelete } from '@/lib/signRequest';

interface ReactionData {
  count: number;
  wallets: string[];
}

interface ChatMessage {
  id: string;
  sender: string;
  username: string | null;
  avatar: string | null;
  message: string;
  replyTo: string | null;
  createdAt: string;
  reactions: Record<string, ReactionData>;
}

const EMOJI_OPTIONS = ['🔥', '👍', '😂', '❤️', '🚀', '👀'];

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
  const wallet = useWallet();
  const { connected, publicKey, connect } = wallet;
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [editingUsername, setEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);
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
    const interval = setInterval(fetchMessages, 5000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  // Fetch profile when connected
  useEffect(() => {
    if (connected && publicKey) {
      fetchProfile(publicKey);
    } else {
      setProfile(null);
    }
  }, [connected, publicKey, fetchProfile]);

  // Chat scroll is handled by flex-direction: column-reverse - no auto-scroll needed

  // Save username
  const saveUsername = async () => {
    if (!publicKey || savingUsername) return;
    
    setSavingUsername(true);
    setError('');

    try {
      const profileData = {
        username: newUsername.trim() || null,
        avatar: null,
      };
      
      const res = await authenticatedPost(wallet, '/api/profile', 'profile', profileData);
      const data = await res.json();
      
      if (data.success) {
        setProfile(data.profile);
        setEditingUsername(false);
      } else {
        setError(data.error || 'Failed to save');
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
    } finally {
      setSavingUsername(false);
    }
  };

  // Get user's current reaction on a message
  const getUserReaction = (msg: ChatMessage): string | null => {
    if (!publicKey) return null;
    for (const [emoji, data] of Object.entries(msg.reactions)) {
      if (data.wallets.includes(publicKey)) return emoji;
    }
    return null;
  };

  // Toggle reaction - only one per user per message
  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!connected || !publicKey) return;

    const message = messages.find(m => m.id === messageId);
    if (!message) return;

    const currentReaction = getUserReaction(message);
    const isSameEmoji = currentReaction === emoji;

    try {
      // If clicking same emoji, remove it
      if (isSameEmoji) {
        const signedData = { messageId, emoji };
        await authenticatedDelete(
          wallet, 
          `/api/reactions?messageId=${messageId}&emoji=${encodeURIComponent(emoji)}`,
          'unreact',
          signedData
        );
        // Update local state - remove reaction
        setMessages(prev => prev.map(m => {
          if (m.id !== messageId) return m;
          const newReactions = { ...m.reactions };
          if (newReactions[emoji]) {
            newReactions[emoji] = {
              count: newReactions[emoji].count - 1,
              wallets: newReactions[emoji].wallets.filter(w => w !== publicKey),
            };
            if (newReactions[emoji].count === 0) {
              delete newReactions[emoji];
            }
          }
          return { ...m, reactions: newReactions };
        }));
      } else {
        // Remove old reaction first if exists
        if (currentReaction) {
          const oldSignedData = { messageId, emoji: currentReaction };
          await authenticatedDelete(
            wallet,
            `/api/reactions?messageId=${messageId}&emoji=${encodeURIComponent(currentReaction)}`,
            'unreact',
            oldSignedData
          );
        }
        // Add new reaction
        const newSignedData = { messageId, emoji };
        await authenticatedPost(wallet, '/api/reactions', 'react', newSignedData);
        // Update local state - swap reactions
        setMessages(prev => prev.map(m => {
          if (m.id !== messageId) return m;
          const newReactions = { ...m.reactions };
          // Remove old reaction if exists
          if (currentReaction && newReactions[currentReaction]) {
            newReactions[currentReaction] = {
              count: newReactions[currentReaction].count - 1,
              wallets: newReactions[currentReaction].wallets.filter(w => w !== publicKey),
            };
            if (newReactions[currentReaction].count === 0) {
              delete newReactions[currentReaction];
            }
          }
          // Add new reaction
          if (newReactions[emoji]) {
            newReactions[emoji] = {
              count: newReactions[emoji].count + 1,
              wallets: [...newReactions[emoji].wallets, publicKey],
            };
          } else {
            newReactions[emoji] = { count: 1, wallets: [publicKey] };
          }
          return { ...m, reactions: newReactions };
        }));
      }
    } catch (err) {
      console.error('Failed to toggle reaction:', err);
    }
  };

  // Send message
  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || sending || !publicKey) return;

    setSending(true);
    setError('');

    try {
      const chatData = {
        mint,
        message: newMessage.trim(),
        replyTo: null,
      };
      
      const res = await authenticatedPost(wallet, '/api/chat', 'chat', chatData);
      const data = await res.json();
      
      if (data.success) {
        setMessages(prev => [...prev, data.message]);
        setNewMessage('');
      } else {
        setError(data.error || 'Failed to send');
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
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
        {connected && publicKey && (
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
                {profile?.username || shortenAddress(publicKey)}
              </button>
            )}
            <span className="text-green-400 text-xs">●</span>
          </div>
        )}
      </div>

      {/* Messages */}
      <div 
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto dark-scrollbar flex flex-col-reverse"
      >
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="animate-spin w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <div className="text-4xl mb-2">🦞</div>
            <div>No messages yet</div>
            <div className="text-sm">{connected ? 'Be the first to chat!' : 'Connect wallet to chat'}</div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="group px-4 py-1.5 first:pt-4 last:pb-4">
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
                  
                  {/* Reactions */}
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    {/* Existing reactions */}
                    {Object.entries(msg.reactions).map(([emoji, data]) => (
                      <button
                        key={emoji}
                        onClick={() => toggleReaction(msg.id, emoji)}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition ${
                          connected && publicKey && data.wallets.includes(publicKey)
                            ? 'bg-orange-500/30 border border-orange-500/50 text-orange-300'
                            : 'bg-gray-700/50 hover:bg-gray-700 text-gray-400'
                        }`}
                        title={`${data.count} reaction${data.count !== 1 ? 's' : ''}`}
                      >
                        <span>{emoji}</span>
                        <span>{data.count}</span>
                      </button>
                    ))}
                    
                    {/* Add reaction button - only show on hover or if connected */}
                    {connected && (
                      <div className="relative inline-block">
                        <button
                          className="opacity-0 group-hover:opacity-100 px-2 py-0.5 rounded-full text-xs bg-gray-700/50 hover:bg-gray-700 text-gray-400 transition"
                          onClick={(e) => {
                            const picker = e.currentTarget.nextElementSibling;
                            picker?.classList.toggle('hidden');
                          }}
                        >
                          +
                        </button>
                        <div className="hidden absolute left-0 bottom-full mb-1 bg-gray-800 border border-gray-700 rounded-lg p-1 flex gap-1 z-10 shadow-lg">
                          {EMOJI_OPTIONS.map(emoji => {
                            const isSelected = getUserReaction(msg) === emoji;
                            return (
                              <button
                                key={emoji}
                                onClick={(e) => {
                                  toggleReaction(msg.id, emoji);
                                  // Close picker
                                  e.currentTarget.parentElement?.classList.add('hidden');
                                }}
                                className={`p-1.5 rounded transition ${
                                  isSelected 
                                    ? 'bg-orange-500/30 ring-1 ring-orange-500' 
                                    : 'hover:bg-gray-700'
                                }`}
                                title={isSelected ? 'Click to remove' : 'Click to react'}
                              >
                                {emoji}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-gray-800">
        {error && (
          <div className="text-red-400 text-xs mb-2">{error}</div>
        )}
        <form onSubmit={sendMessage}>
          <div className="flex gap-2">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder={connected ? "Type a message..." : "Connect wallet to chat..."}
              maxLength={500}
              disabled={!connected}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:border-orange-500 focus:outline-none disabled:opacity-50"
            />
            {connected ? (
              <button
                type="submit"
                disabled={!newMessage.trim() || sending}
                className="bg-orange-500 hover:bg-orange-400 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition"
              >
                {sending ? '...' : 'Send'}
              </button>
            ) : (
              <button
                type="button"
                onClick={connect}
                className="bg-orange-500 hover:bg-orange-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap"
              >
                Connect
              </button>
            )}
          </div>
          {connected && (
            <div className="text-xs text-gray-500 mt-2">
              {newMessage.length}/500
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
