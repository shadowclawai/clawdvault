'use client';

import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { CreateTokenRequest, CreateTokenResponse } from '@/lib/types';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { useWallet } from '@/contexts/WalletContext';

export default function CreatePage() {
  const { connected, publicKey, connect } = useWallet();
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [twitter, setTwitter] = useState('');
  const [telegram, setTelegram] = useState('');
  const [website, setWebsite] = useState('');
  const [initialBuy, setInitialBuy] = useState('');
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CreateTokenResponse | null>(null);
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be under 5MB');
      return;
    }

    // Show preview immediately
    const reader = new FileReader();
    reader.onload = (e) => {
      setImagePreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Upload to server
    setUploading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (data.success) {
        setImage(data.url);
      } else {
        setError(data.error || 'Upload failed');
        setImagePreview(null);
      }
    } catch (err) {
      setError('Upload failed');
      setImagePreview(null);
    } finally {
      setUploading(false);
    }
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0]);
    }
  };

  const removeImage = () => {
    setImage('');
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const body: CreateTokenRequest = {
        name,
        symbol,
        description: description || undefined,
        image: image || undefined,
        twitter: twitter || undefined,
        telegram: telegram || undefined,
        website: website || undefined,
        initialBuy: initialBuy ? parseFloat(initialBuy) : undefined,
      };

      const res = await fetch('/api/create', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(publicKey ? { 'X-Wallet': publicKey } : {}),
        },
        body: JSON.stringify({
          ...body,
          creator: publicKey || undefined,
        }),
      });

      const data: CreateTokenResponse = await res.json();

      if (data.success) {
        setResult(data);
      } else {
        setError(data.error || 'Failed to create token');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen">
      <Header />

      {/* Form */}
      <section className="py-12 px-6">
        <div className="max-w-xl mx-auto">
          <h1 className="text-3xl font-bold text-white mb-2">Launch Your Token 🚀</h1>
          <p className="text-gray-400 mb-8">
            Create a new token on the bonding curve. No coding required.
          </p>

          {result?.success ? (
            <div className="bg-green-900/30 border border-green-500 rounded-xl p-6">
              <h2 className="text-xl font-bold text-green-400 mb-2">✅ Token Created!</h2>
              <p className="text-gray-300 mb-4">
                Your token <span className="font-bold">${result.token?.symbol}</span> is now live.
              </p>
              <div className="bg-gray-800 rounded-lg p-4 font-mono text-sm mb-4">
                <div className="text-gray-500">Mint Address:</div>
                <div className="text-orange-400 break-all">{result.mint}</div>
              </div>
              {(result as any).initialBuy && (
                <div className="bg-gray-800 rounded-lg p-4 text-sm mb-4">
                  <div className="text-green-400 font-medium mb-1">🎉 Initial Buy Complete!</div>
                  <div className="text-gray-300">
                    You bought <span className="text-white font-medium">{(result as any).initialBuy.tokens_received.toLocaleString()}</span> tokens 
                    for <span className="text-white font-medium">{(result as any).initialBuy.sol_spent} SOL</span>
                  </div>
                </div>
              )}
              <div className="flex gap-4">
                <Link
                  href={`/tokens/${result.mint}`}
                  className="bg-orange-500 hover:bg-orange-400 text-white px-6 py-2 rounded-lg transition"
                >
                  View Token
                </Link>
                <button
                  onClick={() => {
                    setResult(null);
                    setName('');
                    setSymbol('');
                    setDescription('');
                    setImage('');
                    setImagePreview(null);
                    setTwitter('');
                    setTelegram('');
                    setWebsite('');
                    setInitialBuy('');
                  }}
                  className="border border-gray-600 hover:border-orange-500 text-white px-6 py-2 rounded-lg transition"
                >
                  Create Another
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {error && (
                <div className="bg-red-900/30 border border-red-500 rounded-lg p-4 text-red-400">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-white font-medium mb-2">
                  Token Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Wolf Pack Token"
                  maxLength={32}
                  required
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:border-orange-500 focus:outline-none"
                />
                <div className="text-gray-500 text-sm mt-1">{name.length}/32 characters</div>
              </div>

              <div>
                <label className="block text-white font-medium mb-2">
                  Symbol *
                </label>
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  placeholder="e.g. WOLF"
                  maxLength={10}
                  required
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:border-orange-500 focus:outline-none uppercase"
                />
                <div className="text-gray-500 text-sm mt-1">{symbol.length}/10 characters</div>
              </div>

              <div>
                <label className="block text-white font-medium mb-2">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What's your token about?"
                  rows={3}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:border-orange-500 focus:outline-none resize-none"
                />
              </div>

              {/* Image Upload */}
              <div>
                <label className="block text-white font-medium mb-2">
                  Token Image
                </label>
                
                {imagePreview || image ? (
                  <div className="relative w-32 h-32 rounded-xl overflow-hidden bg-gray-800 border border-gray-700">
                    <img 
                      src={imagePreview || image} 
                      alt="Token preview" 
                      className="w-full h-full object-cover"
                    />
                    {uploading && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <div className="animate-spin w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full" />
                      </div>
                    )}
                    {!uploading && (
                      <button
                        type="button"
                        onClick={removeImage}
                        className="absolute top-2 right-2 bg-red-500 hover:bg-red-400 text-white w-6 h-6 rounded-full flex items-center justify-center text-sm transition"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ) : (
                  <div
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition ${
                      dragActive 
                        ? 'border-orange-500 bg-orange-500/10' 
                        : 'border-gray-700 hover:border-gray-600 bg-gray-800/50'
                    }`}
                  >
                    <div className="text-4xl mb-2">🖼️</div>
                    <div className="text-gray-400 mb-1">
                      {dragActive ? 'Drop image here' : 'Drag & drop or click to upload'}
                    </div>
                    <div className="text-gray-500 text-sm">PNG, JPG, GIF, WebP (max 5MB)</div>
                  </div>
                )}
                
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />

                {/* Optional: manual URL input */}
                <div className="mt-3">
                  <div className="text-gray-500 text-sm mb-2">Or paste image URL:</div>
                  <input
                    type="url"
                    value={image}
                    onChange={(e) => {
                      setImage(e.target.value);
                      setImagePreview(e.target.value);
                    }}
                    placeholder="https://..."
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:border-orange-500 focus:outline-none text-sm"
                  />
                </div>
              </div>

              {/* Social Links */}
              <div className="space-y-4">
                <label className="block text-white font-medium">
                  Social Links <span className="text-gray-500 font-normal">(optional)</span>
                </label>
                
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
                      <span>𝕏</span>
                      <span>Twitter</span>
                    </div>
                    <input
                      type="text"
                      value={twitter}
                      onChange={(e) => setTwitter(e.target.value)}
                      placeholder="@username or URL"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:border-orange-500 focus:outline-none text-sm"
                    />
                  </div>
                  
                  <div>
                    <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
                      <span>✈️</span>
                      <span>Telegram</span>
                    </div>
                    <input
                      type="text"
                      value={telegram}
                      onChange={(e) => setTelegram(e.target.value)}
                      placeholder="@group or URL"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:border-orange-500 focus:outline-none text-sm"
                    />
                  </div>
                  
                  <div>
                    <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
                      <span>🌐</span>
                      <span>Website</span>
                    </div>
                    <input
                      type="text"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="example.com"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:border-orange-500 focus:outline-none text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Initial Buy */}
              <div>
                <label className="block text-white font-medium mb-2">
                  Initial Buy <span className="text-gray-500 font-normal">(optional)</span>
                </label>
                <p className="text-gray-500 text-sm mb-3">
                  Buy tokens with SOL when your token launches. You'll be the first holder!
                </p>
                <div className="flex gap-2 mb-3">
                  {['0', '0.1', '0.5', '1', '2', '5'].map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => setInitialBuy(amount === '0' ? '' : amount)}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                        (amount === '0' && !initialBuy) || initialBuy === amount
                          ? 'bg-orange-500 text-white'
                          : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                      }`}
                    >
                      {amount === '0' ? 'None' : `${amount} SOL`}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <input
                    type="number"
                    value={initialBuy}
                    onChange={(e) => setInitialBuy(e.target.value)}
                    placeholder="0.0"
                    step="0.01"
                    min="0"
                    max="100"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:border-orange-500 focus:outline-none pr-16"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 font-medium">
                    SOL
                  </span>
                </div>
                {initialBuy && parseFloat(initialBuy) > 0 && (
                  <div className="text-green-400 text-sm mt-2">
                    ✓ You'll buy ~{(parseFloat(initialBuy) / 0.000000028).toLocaleString(undefined, { maximumFractionDigits: 0 })} tokens at launch
                  </div>
                )}
              </div>

              <div className="bg-gray-800/50 rounded-lg p-4 text-sm">
                <div className="text-amber-400 font-medium mb-2">ℹ️ Token Parameters</div>
                <ul className="text-gray-400 space-y-1">
                  <li>• Initial supply: 1,000,000,000 tokens</li>
                  <li>• Starting price: ~0.000000028 SOL</li>
                  <li>• 1% fee on all trades</li>
                  <li>• Graduates to Raydium at ~$69K market cap</li>
                </ul>
              </div>

              {connected ? (
                <button
                  type="submit"
                  disabled={loading || uploading || !name || !symbol}
                  className="w-full bg-gradient-to-r from-orange-600 to-red-500 hover:from-orange-500 hover:to-red-400 disabled:opacity-50 disabled:cursor-not-allowed text-white py-4 rounded-xl font-semibold transition"
                >
                  {loading ? 'Creating...' : uploading ? 'Uploading image...' : 'Launch Token 🚀'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={connect}
                  className="w-full bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white py-4 rounded-xl font-semibold transition flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" viewBox="0 0 200 180" fill="none">
                    <path fillRule="evenodd" clipRule="evenodd" d="M89.1138 112.613C83.1715 121.719 73.2139 133.243 59.9641 133.243C53.7005 133.243 47.6777 130.665 47.6775 119.464C47.677 90.9369 86.6235 46.777 122.76 46.7764C143.317 46.776 151.509 61.0389 151.509 77.2361C151.509 98.0264 138.018 121.799 124.608 121.799C120.352 121.799 118.264 119.462 118.264 115.756C118.264 114.789 118.424 113.741 118.746 112.613C114.168 120.429 105.335 127.683 97.0638 127.683C91.0411 127.683 87.9898 123.895 87.9897 118.576C87.9897 116.642 88.3912 114.628 89.1138 112.613ZM115.936 68.7103C112.665 68.7161 110.435 71.4952 110.442 75.4598C110.449 79.4244 112.689 82.275 115.96 82.2693C119.152 82.2636 121.381 79.4052 121.374 75.4405C121.367 71.4759 119.128 68.7047 115.936 68.7103ZM133.287 68.6914C130.016 68.6972 127.786 71.4763 127.793 75.4409C127.8 79.4055 130.039 82.2561 133.311 82.2504C136.503 82.2448 138.732 79.3863 138.725 75.4216C138.718 71.457 136.479 68.6858 133.287 68.6914Z" fill="currentColor"/>
                  </svg>
                  Connect Wallet to Launch
                </button>
              )}
            </form>
          )}
        </div>
      </section>

      <Footer />
    </main>
  );
}
