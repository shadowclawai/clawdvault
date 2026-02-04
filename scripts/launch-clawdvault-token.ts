import { Keypair, Transaction, Connection } from '@solana/web3.js';
import fs from 'fs';

const API_BASE = 'https://clawdvault.com/api';

async function main() {
  // Load my wallet
  const walletData = JSON.parse(fs.readFileSync('/Users/ashand/.config/solana/claw-wallet.json', 'utf8'));
  const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
  console.log('🦞 Creator wallet:', wallet.publicKey.toBase58());

  // Token details
  const tokenDetails = {
    name: 'ClawdVault',
    symbol: 'CLAWDVAULT',
    description: 'The official token of ClawdVault',
    image: 'https://smmjnkzpspncsfodgeew.supabase.co/storage/v1/object/public/token-images/53fbac96-4f24-4de9-8608-864f841969df.jpg',
    twitter: '@clawdvault',
    website: 'https://clawdvault.com',
    initialBuy: 0.15,
  };

  console.log('\n📋 Token Details:');
  console.log('   Name:', tokenDetails.name);
  console.log('   Symbol:', tokenDetails.symbol);
  console.log('   Description:', tokenDetails.description);
  console.log('   Initial Buy:', tokenDetails.initialBuy, 'SOL');

  // Step 1: Prepare the transaction
  console.log('\n📝 Step 1: Preparing transaction...');
  const prepareRes = await fetch(`${API_BASE}/token/prepare-create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creator: wallet.publicKey.toBase58(),
      name: tokenDetails.name,
      symbol: tokenDetails.symbol,
      initialBuy: tokenDetails.initialBuy,
    }),
  });

  const prepareData: any = await prepareRes.json();
  if (!prepareData.success) {
    console.error('❌ Prepare failed:', prepareData.error);
    process.exit(1);
  }

  console.log('✅ Transaction prepared');
  console.log('   Mint:', prepareData.mint);
  console.log('   Network:', prepareData.network);
  if (prepareData.initialBuy) {
    console.log('   Estimated tokens:', prepareData.initialBuy.estimatedTokens.toLocaleString());
  }

  // Step 2: Sign the transaction
  console.log('\n🔐 Step 2: Signing transaction...');
  const txBuffer = Buffer.from(prepareData.transaction, 'base64');
  const transaction = Transaction.from(txBuffer);
  
  // The transaction is already partially signed by the mint keypair
  // We just need to add our signature
  transaction.partialSign(wallet);

  const signedTx = transaction.serialize();
  console.log('✅ Transaction signed');

  // Step 3: Execute
  console.log('\n🚀 Step 3: Executing transaction...');
  const executeRes = await fetch(`${API_BASE}/token/execute-create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signedTransaction: signedTx.toString('base64'),
      mint: prepareData.mint,
      creator: wallet.publicKey.toBase58(),
      name: tokenDetails.name,
      symbol: tokenDetails.symbol,
      description: tokenDetails.description,
      image: tokenDetails.image,
      twitter: tokenDetails.twitter,
      website: tokenDetails.website,
      initialBuy: prepareData.initialBuy ? {
        solAmount: tokenDetails.initialBuy,
        estimatedTokens: prepareData.initialBuy.estimatedTokens,
      } : undefined,
    }),
  });

  const executeData: any = await executeRes.json();
  if (!executeData.success) {
    console.error('❌ Execute failed:', executeData.error);
    process.exit(1);
  }

  console.log('\n🎉 TOKEN LAUNCHED SUCCESSFULLY! 🦞');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Mint:', prepareData.mint);
  console.log('Signature:', executeData.signature);
  console.log('Explorer:', executeData.explorer);
  console.log('Token Page:', `https://clawdvault.com/tokens/${prepareData.mint}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main().catch(console.error);
