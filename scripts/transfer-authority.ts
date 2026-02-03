/**
 * Transfer Protocol Authority
 * 
 * Transfers the ClawdVault protocol authority to a new wallet.
 * Must be run by the current authority.
 * 
 * Usage: 
 *   npx tsx scripts/transfer-authority.ts <new_authority_pubkey>
 *   MAINNET=1 npx tsx scripts/transfer-authority.ts <new_authority_pubkey>
 */

import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction,
  TransactionInstruction,
  clusterApiUrl, 
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as crypto from 'crypto';

const PROGRAM_ID = new PublicKey('GUyF2TVe32Cid4iGVt2F6wPYDhLSVmTUZBj2974outYM');

// Get connection based on env
const isMainnet = process.env.MAINNET === '1';
const rpcUrl = isMainnet 
  ? (process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com')
  : clusterApiUrl('devnet');
const connection = new Connection(rpcUrl, 'confirmed');

console.log(`Network: ${isMainnet ? 'MAINNET' : 'devnet'}`);
console.log(`RPC: ${rpcUrl}`);

// Load authority wallet
const walletPath = process.env.WALLET_PATH || process.env.HOME + '/.config/solana/claw-wallet.json';
const authority = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
);

console.log('Current authority:', authority.publicKey.toBase58());

// Compute discriminator
function getDiscriminator(name: string): Buffer {
  return crypto.createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}

async function main() {
  const newAuthorityArg = process.argv[2];
  
  if (!newAuthorityArg) {
    console.log('\nUsage: npx tsx scripts/transfer-authority.ts <new_authority_pubkey>');
    console.log('\nExample:');
    console.log('  npx tsx scripts/transfer-authority.ts 3X8b5mRCzvvyVXarimyujxtCZ1Epn22oXVWbzUoxWKRH');
    console.log('  MAINNET=1 npx tsx scripts/transfer-authority.ts 3X8b5mRCzvvyVXarimyujxtCZ1Epn22oXVWbzUoxWKRH');
    return;
  }

  const newAuthority = new PublicKey(newAuthorityArg);
  console.log('New authority:', newAuthority.toBase58());

  // Find config PDA
  const [configPDA] = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID);
  console.log('Config PDA:', configPDA.toBase58());

  // Check current config
  const configAccount = await connection.getAccountInfo(configPDA);
  if (!configAccount) {
    console.error('❌ Config not found! Protocol may not be initialized.');
    return;
  }

  // Parse current authority (at offset 8)
  const currentAuthority = new PublicKey(configAccount.data.slice(8, 40));
  console.log('\nCurrent on-chain authority:', currentAuthority.toBase58());

  if (!currentAuthority.equals(authority.publicKey)) {
    console.error('❌ Your wallet is not the current authority!');
    console.error(`   Your wallet: ${authority.publicKey.toBase58()}`);
    console.error(`   On-chain authority: ${currentAuthority.toBase58()}`);
    return;
  }

  if (currentAuthority.equals(newAuthority)) {
    console.log('⚠️ New authority is same as current authority. Nothing to do.');
    return;
  }

  console.log('\n⚠️  WARNING: This will transfer protocol authority!');
  console.log(`   From: ${currentAuthority.toBase58()}`);
  console.log(`   To:   ${newAuthority.toBase58()}`);
  console.log('\nProceeding in 5 seconds... (Ctrl+C to cancel)');
  
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Build transaction
  const discriminator = getDiscriminator('transfer_authority');
  console.log('Discriminator:', discriminator.toString('hex'));

  const data = Buffer.concat([
    discriminator,
    newAuthority.toBuffer(),
  ]);

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      { pubkey: configPDA, isSigner: false, isWritable: true },
    ],
    data,
  });

  const tx = new Transaction().add(instruction);
  tx.feePayer = authority.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  console.log('\n📝 Sending transaction...');
  const signature = await sendAndConfirmTransaction(connection, tx, [authority]);
  console.log('✅ Authority transferred!');
  console.log('   Signature:', signature);

  // Verify
  const updatedConfig = await connection.getAccountInfo(configPDA);
  if (updatedConfig) {
    const verifyAuthority = new PublicKey(updatedConfig.data.slice(8, 40));
    console.log('\n✅ Verified new authority:', verifyAuthority.toBase58());
  }
}

main().catch(console.error);
