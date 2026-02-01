'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface ChatMessage {
  id: string;
  sender: string;
  senderName: string | null;
  message: string;
  replyTo: string | null;
  createdAt: string;
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
  if (address === 'anonymous') return '🐺 anon';
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
        setWalletAddress(response.publicKey.toString());
      } else {
        setError('Phantom wallet not found');
      }
    } catch (err) {
      console.error('Wallet connection error:', err);
    }
  };

  // Send message
  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || sending) return;

    setSending(true);
    setError('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mint,
          sender: walletAddress || 'anonymous',
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

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex flex-col" style={{ height: '400px' }}>
      {/* Header */}
      <div className="bg-gray-800/50 px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">💬</span>
          <span className="font-medium text-white">${tokenSymbol} Chat</span>
          <span className="text-gray-500 text-sm">({messages.length})</span>
        </div>
        {!walletAddress && (
          <button
            onClick={connectWallet}
            className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1 rounded-lg transition"
          >
            Connect Wallet
          </button>
        )}
        {walletAddress && (
          <span className="text-xs text-green-400">
            ✓ {shortenAddress(walletAddress)}
          </span>
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
            <div className="text-sm">Be the first to chat!</div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="group">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className={`font-medium text-sm ${
                      msg.sender === 'anonymous' 
                        ? 'text-gray-400' 
                        : 'text-orange-400'
                    }`}>
                      {msg.senderName || shortenAddress(msg.sender)}
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
      <form onSubmit={sendMessage} className="p-3 border-t border-gray-800">
        {error && (
          <div className="text-red-400 text-xs mb-2">{error}</div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder={walletAddress ? "Type a message..." : "Chat as anon..."}
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
        <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
          <span>{newMessage.length}/500</span>
          {!walletAddress && (
            <span>Connect wallet to show your address</span>
          )}
        </div>
      </form>
    </div>
  );
}
