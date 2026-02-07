'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

interface WalletContextType {
  connected: boolean;
  connecting: boolean;
  initializing: boolean; // true while checking auto-reconnect
  publicKey: string | null;
  balance: number | null; // SOL balance
  connect: () => Promise<void>;
  disconnect: () => void;
  signMessage: (message: string) => Promise<Uint8Array | null>;
  signTransaction: (transaction: string) => Promise<string | null>; // base64 in, base64 out
  signAndSendTransaction: (transaction: string) => Promise<string | null>; // base64 in, signature out
  refreshBalance: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType>({
  connected: false,
  connecting: false,
  initializing: true,
  publicKey: null,
  balance: null,
  connect: async () => {},
  disconnect: () => {},
  signMessage: async () => null,
  signTransaction: async () => null,
  signAndSendTransaction: async () => null,
  refreshBalance: async () => {},
});

export function useWallet() {
  return useContext(WalletContext);
}

interface PhantomProvider {
  isPhantom: boolean;
  publicKey: { toString: () => string } | null;
  isConnected: boolean;
  connect: () => Promise<{ publicKey: { toString: () => string } }>;
  disconnect: () => Promise<void>;
  signMessage: (message: Uint8Array, encoding: string) => Promise<{ signature: Uint8Array }>;
  signTransaction: (transaction: any) => Promise<any>;
  signAndSendTransaction: (transaction: any, options?: any) => Promise<{ signature: string }>;
  on: (event: string, callback: () => void) => void;
  off: (event: string, callback: () => void) => void;
}

declare global {
  interface Window {
    phantom?: {
      solana?: PhantomProvider;
    };
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  const getProvider = useCallback((): PhantomProvider | null => {
    if (typeof window !== 'undefined' && window.phantom?.solana?.isPhantom) {
      return window.phantom.solana;
    }
    return null;
  }, []);

  // Fetch SOL balance
  const refreshBalance = useCallback(async () => {
    if (!publicKey) {
      setBalance(null);
      return;
    }

    console.log(`[Wallet] Fetching balance for: ${publicKey}`);
    
    try {
      // Use our secure RPC proxy (API key is server-side only)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch('/api/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getBalance',
          params: [publicKey],
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        console.warn(`[Wallet] RPC proxy returned ${response.status}`);
        setBalance(null);
        return;
      }
      
      const data = await response.json();
      
      if (data.result?.value !== undefined) {
        // Convert lamports to SOL
        const solBalance = data.result.value / 1e9;
        console.log(`[Wallet] ✅ Balance fetched from proxy: ${solBalance} SOL`);
        setBalance(solBalance);
        return;
      }
      if (data.error) {
        console.warn(`[Wallet] RPC proxy error:`, data.error);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.warn(`[Wallet] RPC proxy timed out after 10s`);
      } else {
        console.warn(`[Wallet] Failed to fetch from proxy:`, err);
      }
    }
    
    // Fallback to public RPC if proxy fails
    console.warn('[Wallet] Proxy failed, trying fallback...');
    setBalance(null);
  }, [publicKey]);

  // Connect wallet
  const connect = useCallback(async () => {
    console.log('[Wallet] Connect clicked');
    const provider = getProvider();
    
    if (!provider) {
      console.log('[Wallet] No Phantom provider found, opening phantom.app');
      window.open('https://phantom.app/', '_blank');
      return;
    }

    console.log('[Wallet] Phantom provider found, attempting connection...');
    
    try {
      setConnecting(true);
      const response = await provider.connect();
      const address = response.publicKey.toString();
      console.log('[Wallet] Connected successfully:', address);
      setPublicKey(address);
      setConnected(true);
      
      // Store in localStorage for reconnection
      localStorage.setItem('walletConnected', 'true');
    } catch (err: any) {
      console.error('[Wallet] Connection failed:', err);
      // User rejected or other error
      if (err?.code === 4001) {
        console.log('[Wallet] User rejected connection');
      }
    } finally {
      setConnecting(false);
    }
  }, [getProvider]);

  // Disconnect wallet
  const disconnect = useCallback(() => {
    const provider = getProvider();
    if (provider) {
      provider.disconnect();
    }
    setPublicKey(null);
    setConnected(false);
    setBalance(null);
    localStorage.removeItem('walletConnected');
  }, [getProvider]);

  // Sign message (for verification)
  const signMessage = useCallback(async (message: string): Promise<Uint8Array | null> => {
    const provider = getProvider();
    if (!provider || !connected) return null;

    try {
      const encodedMessage = new TextEncoder().encode(message);
      const { signature } = await provider.signMessage(encodedMessage, 'utf8');
      return signature;
    } catch (err) {
      console.error('Failed to sign message:', err);
      return null;
    }
  }, [getProvider, connected]);

  // Sign transaction (returns signed transaction as base64)
  // Supports both legacy Transaction and VersionedTransaction (for Jupiter)
  const signTransaction = useCallback(async (transactionBase64: string): Promise<string | null> => {
    const provider = getProvider();
    if (!provider || !connected) return null;

    try {
      // Decode base64 to buffer
      const transactionBuffer = Buffer.from(transactionBase64, 'base64');
      
      // Import both Transaction types from @solana/web3.js
      const { Transaction, VersionedTransaction } = await import('@solana/web3.js');
      
      // Check if it's a versioned transaction (first byte indicates version)
      // Versioned transactions start with a version byte (0x80 for v0)
      const isVersioned = transactionBuffer[0] >= 0x80;
      
      if (isVersioned) {
        // VersionedTransaction (used by Jupiter)
        const transaction = VersionedTransaction.deserialize(transactionBuffer);
        const signedTransaction = await provider.signTransaction(transaction);
        const serialized = signedTransaction.serialize();
        return Buffer.from(serialized).toString('base64');
      } else {
        // Legacy Transaction
        const transaction = Transaction.from(transactionBuffer);
        const signedTransaction = await provider.signTransaction(transaction);
        const serialized = signedTransaction.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        });
        return Buffer.from(serialized).toString('base64');
      }
    } catch (err) {
      console.error('Failed to sign transaction:', err);
      return null;
    }
  }, [getProvider, connected]);

  // Sign and send transaction (returns signature)
  const signAndSendTransaction = useCallback(async (transactionBase64: string): Promise<string | null> => {
    const provider = getProvider();
    if (!provider || !connected) return null;

    try {
      // Decode base64 to buffer
      const transactionBuffer = Buffer.from(transactionBase64, 'base64');
      
      // Import Transaction from @solana/web3.js at runtime
      const { Transaction } = await import('@solana/web3.js');
      const transaction = Transaction.from(transactionBuffer);
      
      // Sign and send with Phantom
      const { signature } = await provider.signAndSendTransaction(transaction);
      return signature;
    } catch (err) {
      console.error('Failed to sign and send transaction:', err);
      return null;
    }
  }, [getProvider, connected]);

  // Auto-reconnect on page load
  useEffect(() => {
    const provider = getProvider();
    if (!provider) {
      setInitializing(false);
      return;
    }

    const wasConnected = localStorage.getItem('walletConnected') === 'true';
    
    const attemptReconnect = async () => {
      try {
        // If already connected, just sync state
        if (provider.isConnected && provider.publicKey) {
          console.log('[Wallet] Already connected, syncing state');
          setPublicKey(provider.publicKey.toString());
          setConnected(true);
          return;
        }
        
        // If was previously connected, try to reconnect silently
        if (wasConnected) {
          console.log('[Wallet] Attempting auto-reconnect...');
          try {
            // Use eagerly connect (no popup if already authorized)
            const response = await provider.connect();
            const address = response.publicKey.toString();
            console.log('[Wallet] Auto-reconnected:', address);
            setPublicKey(address);
            setConnected(true);
          } catch (err) {
            console.log('[Wallet] Auto-reconnect failed, clearing state');
            localStorage.removeItem('walletConnected');
          }
        }
      } finally {
        setInitializing(false);
      }
    };

    attemptReconnect();

    // Listen for account changes
    const handleAccountChange = () => {
      if (provider.publicKey) {
        setPublicKey(provider.publicKey.toString());
      } else {
        disconnect();
      }
    };

    provider.on('accountChanged', handleAccountChange);
    
    return () => {
      provider.off('accountChanged', handleAccountChange);
    };
  }, [getProvider, disconnect]);

  // Refresh balance when connected
  useEffect(() => {
    if (connected && publicKey) {
      refreshBalance();
      // Refresh every 30 seconds
      const interval = setInterval(refreshBalance, 30000);
      return () => clearInterval(interval);
    }
  }, [connected, publicKey, refreshBalance]);

  return (
    <WalletContext.Provider
      value={{
        connected,
        connecting,
        initializing,
        publicKey,
        balance,
        connect,
        disconnect,
        signMessage,
        signTransaction,
        signAndSendTransaction,
        refreshBalance,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}
