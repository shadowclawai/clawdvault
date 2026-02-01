/**
 * Client-side Solana RPC utilities
 * These run in the browser to avoid rate limiting on our server
 */

// Public RPC endpoints (client can use these directly)
const RPC_ENDPOINTS = {
  devnet: 'https://api.devnet.solana.com',
  mainnet: 'https://api.mainnet-beta.solana.com',
};

// Get RPC URL based on network (default devnet for now)
export function getRpcUrl(): string {
  // In production, could use env var or detect from the network
  return RPC_ENDPOINTS.devnet;
}

// Platform wallet (bonding curve) - public info
export const PLATFORM_WALLET = '3X8b5mRCzvvyVXarimyujxtCZ1Epn22oXVWbzUoxWKRH';

interface TokenHolder {
  address: string;
  balance: number;
  percentage: number;
  label?: string;
}

/**
 * Fetch token holders directly from Solana RPC (client-side)
 */
export async function fetchHoldersClient(
  mint: string, 
  creator?: string
): Promise<{
  holders: TokenHolder[];
  totalSupply: number;
  circulatingSupply: number;
}> {
  const rpcUrl = getRpcUrl();
  
  // Get largest token accounts
  const largestResponse = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenLargestAccounts',
      params: [mint],
    }),
  });
  const largestData = await largestResponse.json();
  
  // Get total supply
  const supplyResponse = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'getTokenSupply',
      params: [mint],
    }),
  });
  const supplyData = await supplyResponse.json();
  
  const totalSupply = parseFloat(supplyData.result?.value?.uiAmountString || '1000000000');
  const accounts = largestData.result?.value || [];
  
  // Get owner for each account (batch request)
  const ownerRequests = accounts.map((acc: any, i: number) => ({
    jsonrpc: '2.0',
    id: i + 10,
    method: 'getAccountInfo',
    params: [acc.address, { encoding: 'jsonParsed' }],
  }));
  
  const ownersResponse = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ownerRequests),
  });
  const ownersData = await ownersResponse.json();
  
  // Process holders
  const holders: TokenHolder[] = [];
  let bondingCurveBalance = 0;
  
  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    const balance = parseFloat(acc.uiAmountString || '0');
    if (balance === 0) continue;
    
    const ownerInfo = Array.isArray(ownersData) 
      ? ownersData.find((r: any) => r.id === i + 10)
      : ownersData;
    const owner = ownerInfo?.result?.value?.data?.parsed?.info?.owner || acc.address;
    
    const percentage = (balance / totalSupply) * 100;
    const isPlatform = owner === PLATFORM_WALLET;
    const isCreator = creator && owner === creator;
    
    if (isPlatform) {
      bondingCurveBalance = balance;
    }
    
    let label: string | undefined;
    if (isPlatform) label = 'Bonding Curve';
    else if (isCreator) label = 'Creator (dev)';
    
    holders.push({ address: owner, balance, percentage, label });
  }
  
  // Sort by balance
  holders.sort((a, b) => b.balance - a.balance);
  
  return {
    holders: holders.slice(0, 10),
    totalSupply,
    circulatingSupply: totalSupply - bondingCurveBalance,
  };
}

/**
 * Fetch token balance for a wallet (client-side)
 */
export async function fetchBalanceClient(
  mint: string,
  wallet: string
): Promise<number> {
  const rpcUrl = getRpcUrl();
  
  // Get token accounts for wallet
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenAccountsByOwner',
      params: [
        wallet,
        { mint },
        { encoding: 'jsonParsed' },
      ],
    }),
  });
  const data = await response.json();
  
  const accounts = data.result?.value || [];
  if (accounts.length === 0) return 0;
  
  // Sum up balances (usually just one account)
  let total = 0;
  for (const acc of accounts) {
    total += parseFloat(acc.account?.data?.parsed?.info?.tokenAmount?.uiAmountString || '0');
  }
  
  return total;
}

/**
 * Get SOL balance for a wallet (client-side)
 */
export async function fetchSolBalanceClient(wallet: string): Promise<number> {
  const rpcUrl = getRpcUrl();
  
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getBalance',
      params: [wallet],
    }),
  });
  const data = await response.json();
  
  const lamports = data.result?.value || 0;
  return lamports / 1_000_000_000; // Convert to SOL
}
