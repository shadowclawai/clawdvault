import { Connection, PublicKey } from '@solana/web3.js';

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=bc8abd94-3db9-4d85-8870-65d72824c7fa';
const PROGRAM_ID = new PublicKey('GUyF2TVe32Cid4iGVt2F6wPYDhLSVmTUZBj2974outYM');
const CLAWDVAULT_MINT = 'B7KpChn4dxioeuNzzEY9eioUwEi5xt5KYegytRottJgZ';

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  
  console.log('Fetching all program transactions...');
  const sigs = await connection.getSignaturesForAddress(PROGRAM_ID, { limit: 500 });
  
  console.log(`Found ${sigs.length} program transactions\n`);
  console.log('Looking for CLAWDVAULT trades...\n');
  
  let found = 0;
  for (const sig of sigs) {
    const tx = await connection.getTransaction(sig.signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    
    // Check if this transaction involves CLAWDVAULT mint
    const logs = tx?.meta?.logMessages?.join(' ') || '';
    if (logs.includes(CLAWDVAULT_MINT) || logs.includes('TradeEvent')) {
      // Check accounts for the mint
      const accountKeys = tx?.transaction.message.staticAccountKeys?.map(k => k.toBase58()) || [];
      if (accountKeys.includes(CLAWDVAULT_MINT)) {
        found++;
        console.log(`${found}. ${sig.signature.slice(0,12)}... | ${new Date(sig.blockTime! * 1000).toISOString()}`);
      }
    }
    
    // Rate limit
    await new Promise(r => setTimeout(r, 100));
  }
  
  console.log(`\nTotal CLAWDVAULT transactions: ${found}`);
}
main().catch(console.error);
