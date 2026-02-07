'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { authenticatedPost, authenticatedDelete } from '@/lib/signRequest';
import { Trade } from '@/lib/types';
import { 
  subscribeToChatMessages, 
  subscribeToTrades, 
  subscribeToReactions,
  unsubscribeChannel,
  RealtimeMessage,
  RealtimeTrade
} from '@/lib/supabase-client';

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

interface ChatAndTradesProps {
  mint: string;
  tokenSymbol: string;
  trades: Trade[];
  onTradesUpdate?: () => void;
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

function formatNumber(num: number | null | undefined): string {
  if (num == null || isNaN(num)) return '0';
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + 'B';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(2) + 'K';
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function ChatAndTrades({ mint, tokenSymbol, trades, onTradesUpdate }: ChatAndTradesProps) {
  const wallet = useWallet();
  const { connected, publicKey, connect } = wallet;
  
  const [activeTab, setActiveTab] = useState<'thread' | 'trades'>('thread');
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
  const tradesContainerRef = useRef<HTMLDivElement>(null);

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

  // Initial load + realtime subscriptions for chat
  useEffect(() => {
    fetchMessages();
    
    // Subscribe to realtime chat messages
    const chatChannel = subscribeToChatMessages(
      mint,
      async (newMsg: RealtimeMessage) => {
        // Fetch the full message with profile info from API
        // (realtime only gives us the raw row)
        try {
          const res = await fetch(`/api/chat?mint=${mint}&limit=100`);
          const data = await res.json();
          if (data.success) {
            setMessages(data.messages);
          }
        } catch (err) {
          console.error('Failed to fetch after realtime update:', err);
        }
      },
      (deletedId: string) => {
        setMessages(prev => prev.filter(m => m.id !== deletedId));
      }
    );
    
    // Subscribe to reactions
    const reactionsChannel = subscribeToReactions(mint, () => {
      // Refetch messages to get updated reaction counts
      fetchMessages();
    });
    
    return () => {
      unsubscribeChannel(chatChannel);
      unsubscribeChannel(reactionsChannel);
    };
  }, [mint, fetchMessages]);

  // Realtime trades subscription
  useEffect(() => {
    if (!onTradesUpdate) return;
    
    // Initial fetch
    onTradesUpdate();
    
    // Subscribe to realtime trades
    const tradesChannel = subscribeToTrades(mint, (newTrade: RealtimeTrade) => {
      // Trigger parent to refetch trades
      onTradesUpdate();
    });
    
    return () => {
      unsubscribeChannel(tradesChannel);
    };
  }, [mint, onTradesUpdate]);

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

  // Toggle reaction
  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!connected || !publicKey) return;

    const message = messages.find(m => m.id === messageId);
    if (!message) return;

    const currentReaction = getUserReaction(message);
    const isSameEmoji = currentReaction === emoji;

    try {
      if (isSameEmoji) {
        const signedData = { messageId, emoji };
        await authenticatedDelete(
          wallet, 
          `/api/reactions?messageId=${messageId}&emoji=${encodeURIComponent(emoji)}`,
          'unreact',
          signedData
        );
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
        if (currentReaction) {
          const oldSignedData = { messageId, emoji: currentReaction };
          await authenticatedDelete(
            wallet,
            `/api/reactions?messageId=${messageId}&emoji=${encodeURIComponent(currentReaction)}`,
            'unreact',
            oldSignedData
          );
        }
        const newSignedData = { messageId, emoji };
        await authenticatedPost(wallet, '/api/reactions', 'react', newSignedData);
        setMessages(prev => prev.map(m => {
          if (m.id !== messageId) return m;
          const newReactions = { ...m.reactions };
          if (currentReaction && newReactions[currentReaction]) {
            newReactions[currentReaction] = {
              count: newReactions[currentReaction].count - 1,
              wallets: newReactions[currentReaction].wallets.filter(w => w !== publicKey),
            };
            if (newReactions[currentReaction].count === 0) {
              delete newReactions[currentReaction];
            }
          }
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
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex flex-col" style={{ height: '480px' }}>
      {/* Tabs Header */}
      <div className="bg-gray-800/50 border-b border-gray-800">
        <div className="flex">
          <button
            onClick={() => setActiveTab('thread')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition border-b-2 ${
              activeTab === 'thread'
                ? 'text-orange-400 border-orange-500 bg-gray-800/30'
                : 'text-gray-400 border-transparent hover:text-white'
            }`}
          >
            💬 Thread
            <span className="ml-1 text-xs text-gray-500">({messages.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('trades')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition border-b-2 ${
              activeTab === 'trades'
                ? 'text-orange-400 border-orange-500 bg-gray-800/30'
                : 'text-gray-400 border-transparent hover:text-white'
            }`}
          >
            📊 Trades
            <span className="ml-1 text-xs text-gray-500">({trades.length})</span>
          </button>
        </div>
        
        {/* Username edit - only show on thread tab when connected */}
        {activeTab === 'thread' && connected && publicKey && (
          <div className="px-4 py-2 border-t border-gray-700/50 flex items-center justify-between">
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
            <span className="text-green-400 text-xs">● Connected</span>
          </div>
        )}
      </div>

      {/* Thread Content */}
      {activeTab === 'thread' && (
        <>
          <div 
            ref={chatContainerRef}
            className="flex-1 min-h-0 overflow-y-auto dark-scrollbar flex flex-col-reverse"
          >
            {loading ? (
              <div className="flex items-center justify-center py-20 text-gray-500">
                <div className="animate-spin w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-500">
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

          {/* Chat Input */}
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
        </>
      )}

      {/* Trades Content */}
      {activeTab === 'trades' && (
        <div 
          ref={tradesContainerRef}
          className="flex-1 min-h-0 overflow-y-auto dark-scrollbar"
        >
          {trades.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-500">
              <div className="text-4xl mb-2">📊</div>
              <div>No trades yet</div>
              <div className="text-sm">Be the first to trade!</div>
            </div>
          ) : (
            <div className="divide-y divide-gray-800/50">
              {trades.map((trade) => (
                <div 
                  key={trade.id} 
                  className={`flex items-center gap-3 px-4 py-3 transition ${
                    trade.type === 'buy' 
                      ? 'hover:bg-green-900/10' 
                      : 'hover:bg-red-900/10'
                  }`}
                >
                  {/* Trade Type Icon */}
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                    trade.type === 'buy' ? 'bg-green-500/20' : 'bg-red-500/20'
                  }`}>
                    <span className={`text-lg ${trade.type === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                      {trade.type === 'buy' ? '↗' : '↘'}
                    </span>
                  </div>
                  
                  {/* Trade Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <a 
                        href={`https://solscan.io/account/${trade.trader}${process.env.NEXT_PUBLIC_SOLANA_NETWORK === 'mainnet-beta' ? '' : '?cluster=' + (process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-300 hover:text-cyan-400 font-mono text-sm hover:underline"
                      >
                        {shortenAddress(trade.trader)}
                      </a>
                      <span className={`text-xs font-medium ${
                        trade.type === 'buy' ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {trade.type === 'buy' ? 'bought' : 'sold'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-white font-mono text-sm font-medium">
                        {formatNumber(trade.token_amount)} {tokenSymbol}
                      </span>
                      <span className="text-gray-500 text-xs">
                        for
                      </span>
                      <span className={`font-mono text-sm ${
                        trade.type === 'buy' ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {(trade.sol_amount || 0).toFixed(4)} SOL
                      </span>
                    </div>
                  </div>
                  
                  {/* Timestamp & Tx Link */}
                  <div className="text-right flex-shrink-0 flex items-center gap-2">
                    <span className="text-gray-500 text-xs">
                      {formatTimeAgo(new Date(trade.created_at))}
                    </span>
                    {trade.signature && (
                      <a
                        href={`https://solscan.io/tx/${trade.signature}${process.env.NEXT_PUBLIC_SOLANA_NETWORK === 'mainnet-beta' ? '' : '?cluster=' + (process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-500 hover:text-cyan-400 transition"
                        title="View transaction"
                      >
                        🔗
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
