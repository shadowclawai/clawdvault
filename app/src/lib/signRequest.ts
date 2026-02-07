import bs58 from 'bs58';

/**
 * Wallet interface matching our WalletContext
 */
interface WalletInterface {
  publicKey: string | null;
  signMessage: (message: string) => Promise<Uint8Array | null>;
}

/**
 * Create the message format that the server expects
 */
export function createSignableMessage(action: string, data: Record<string, unknown>): string {
  const timestamp = Math.floor(Date.now() / 1000);
  // Round to 5-minute windows to match server
  const window = Math.floor(timestamp / 300) * 300;
  return `ClawdVault:${action}:${window}:${JSON.stringify(data)}`;
}

/**
 * Sign a request with the connected wallet
 * Returns headers to include in the fetch request
 */
export async function signRequest(
  wallet: WalletInterface,
  action: string,
  data: Record<string, unknown>
): Promise<{ 'X-Wallet': string; 'X-Signature': string } | null> {
  if (!wallet.publicKey || !wallet.signMessage) {
    console.error('Wallet not connected or does not support signing');
    return null;
  }

  try {
    const message = createSignableMessage(action, data);
    const signature = await wallet.signMessage(message);
    
    if (!signature) {
      console.error('Wallet returned null signature');
      return null;
    }
    
    return {
      'X-Wallet': wallet.publicKey,
      'X-Signature': bs58.encode(signature),
    };
  } catch (error) {
    console.error('Failed to sign request:', error);
    return null;
  }
}

const SESSION_KEY = 'clawdvault_session';

/**
 * Get stored session token
 */
export function getSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem(SESSION_KEY);
  if (!stored) return null;
  
  try {
    const { token, expiresAt } = JSON.parse(stored);
    if (new Date(expiresAt) < new Date()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return token;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

/**
 * Store session token
 */
export function setSessionToken(token: string, expiresIn: number): void {
  if (typeof window === 'undefined') return;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  localStorage.setItem(SESSION_KEY, JSON.stringify({ token, expiresAt }));
}

/**
 * Clear session token
 */
export function clearSessionToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SESSION_KEY);
}

/**
 * Create a new session (requires signing once)
 */
export async function createSession(wallet: WalletInterface): Promise<string | null> {
  const signedData = { action: 'create_session' };
  const authHeaders = await signRequest(wallet, 'session', signedData);
  
  if (!authHeaders) {
    return null;
  }

  try {
    const res = await fetch('/api/auth/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
    });
    
    const data = await res.json();
    if (data.success && data.token) {
      setSessionToken(data.token, data.expiresIn);
      return data.token;
    }
    return null;
  } catch (error) {
    console.error('Failed to create session:', error);
    return null;
  }
}

/**
 * Get or create session token
 */
export async function getOrCreateSession(wallet: WalletInterface): Promise<string | null> {
  // Check for existing valid session
  const existing = getSessionToken();
  if (existing) return existing;
  
  // Create new session
  return createSession(wallet);
}

/**
 * Make an authenticated POST request (tries session first, falls back to signature)
 */
export async function authenticatedPost(
  wallet: WalletInterface,
  url: string,
  action: string,
  data: Record<string, unknown>
): Promise<Response> {
  // For chat-related actions, try session auth first
  if (action === 'chat' || action === 'react') {
    const sessionToken = await getOrCreateSession(wallet);
    if (sessionToken) {
      return fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`,
        },
        body: JSON.stringify(data),
      });
    }
  }
  
  // Fall back to per-request signing
  const authHeaders = await signRequest(wallet, action, data);
  
  if (!authHeaders) {
    throw new Error('Failed to sign request - wallet may have rejected');
  }

  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify(data),
  });
}

/**
 * Make an authenticated DELETE request (tries session first, falls back to signature)
 */
export async function authenticatedDelete(
  wallet: WalletInterface,
  url: string,
  action: string,
  signedData: Record<string, unknown>
): Promise<Response> {
  // For unreact action, try session auth first
  if (action === 'unreact') {
    const sessionToken = await getOrCreateSession(wallet);
    if (sessionToken) {
      return fetch(url, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
        },
      });
    }
  }
  
  // Fall back to per-request signing
  const authHeaders = await signRequest(wallet, action, signedData);
  
  if (!authHeaders) {
    throw new Error('Failed to sign request - wallet may have rejected');
  }

  return fetch(url, {
    method: 'DELETE',
    headers: {
      ...authHeaders,
    },
  });
}
