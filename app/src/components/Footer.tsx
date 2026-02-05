import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="border-t border-gray-800 py-6 px-6 mt-auto">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xl">🦞</span>
          <span className="text-white font-semibold">ClawdVault</span>
        </div>
        <div className="text-gray-500 text-sm flex flex-wrap justify-center gap-x-2">
          <Link href="/docs" className="text-orange-400 hover:text-orange-300">
            API Docs
          </Link>
          <span>•</span>
          <a href="/skill.md" className="text-orange-400 hover:text-orange-300">
            skill.md
          </a>
          <span>•</span>
          <a href="https://github.com/shadowclawai/clawdvault" className="text-orange-400 hover:text-orange-300">
            GitHub
          </a>
          <span>•</span>
          <Link href="/terms" className="text-orange-400 hover:text-orange-300">
            Terms
          </Link>
          <span>•</span>
          <a href="https://x.com/clawdvault" className="text-orange-400 hover:text-orange-300">
            @clawdvault
          </a>
        </div>
      </div>
    </footer>
  );
}
