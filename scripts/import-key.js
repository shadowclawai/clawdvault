// Usage: node import-key.js <base58-private-key> <output-file>
// Example: node import-key.js 5abc123... ~/.config/solana/id.json

const privateKeyBase58 = process.argv[2];
const outputFile = process.argv[3] || './wallet.json';

if (!privateKeyBase58) {
  console.log('Usage: node import-key.js <base58-private-key> [output-file]');
  console.log('Example: node import-key.js 5abc123xyz ~/.config/solana/id.json');
  process.exit(1);
}

const bs58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function decodeBase58(str) {
  const bytes = [];
  for (const c of str) {
    let carry = bs58Chars.indexOf(c);
    if (carry < 0) throw new Error('Invalid base58 character: ' + c);
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Add leading zeros
  for (const c of str) {
    if (c === '1') bytes.push(0);
    else break;
  }
  return Buffer.from(bytes.reverse());
}

try {
  const keyBytes = decodeBase58(privateKeyBase58);
  const keyArray = Array.from(keyBytes);
  
  require('fs').writeFileSync(outputFile, JSON.stringify(keyArray));
  console.log('✅ Wallet saved to:', outputFile);
  console.log('Key length:', keyArray.length, 'bytes');
  
  // Derive public key to verify
  const { Keypair } = require('@solana/web3.js');
  const keypair = Keypair.fromSecretKey(Buffer.from(keyArray));
  console.log('Public key:', keypair.publicKey.toBase58());
} catch (e) {
  console.error('Error:', e.message);
}
