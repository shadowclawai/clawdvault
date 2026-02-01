'use client';

import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { CreateTokenRequest, CreateTokenResponse } from '@/lib/types';

export default function CreatePage() {
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [twitter, setTwitter] = useState('');
  const [telegram, setTelegram] = useState('');
  const [website, setWebsite] = useState('');
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
      };

      const res = await fetch('/api/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-2xl">🦀</span>
            <span className="text-xl font-bold text-white">ClawdVault</span>
          </Link>
          <nav className="flex items-center gap-6">
            <Link href="/create" className="text-white font-medium">
              Create Token
            </Link>
            <Link href="/tokens" className="text-gray-400 hover:text-white transition">
              Browse
            </Link>
          </nav>
        </div>
      </header>

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

              <div className="bg-gray-800/50 rounded-lg p-4 text-sm">
                <div className="text-amber-400 font-medium mb-2">ℹ️ Token Parameters</div>
                <ul className="text-gray-400 space-y-1">
                  <li>• Initial supply: 1,073,000,000 tokens</li>
                  <li>• Starting price: ~0.000028 SOL</li>
                  <li>• 1% fee on all trades</li>
                  <li>• Graduates to Raydium at ~$69K market cap</li>
                </ul>
              </div>

              <button
                type="submit"
                disabled={loading || uploading || !name || !symbol}
                className="w-full bg-gradient-to-r from-orange-600 to-red-500 hover:from-orange-500 hover:to-red-400 disabled:opacity-50 disabled:cursor-not-allowed text-white py-4 rounded-xl font-semibold transition"
              >
                {loading ? 'Creating...' : uploading ? 'Uploading image...' : 'Launch Token 🚀'}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
