import Link from "next/link";

export default function Header() {
  return (
    <header className="h-12 bg-white/70 backdrop-blur-xl border-b border-black/[.06] px-6 flex items-center justify-between fixed top-0 left-0 right-0 z-40">
      <Link href="/" className="text-sm font-semibold text-ink">
        TRACK POLICY
      </Link>
      <nav className="flex items-center gap-6 text-xs text-muted">
        <Link href="/" className="hover:text-ink transition-colors">
          Map
        </Link>
        <Link href="/bills" className="hover:text-ink transition-colors">
          Bills
        </Link>
        <Link href="/politicians" className="hover:text-ink transition-colors">
          Politicians
        </Link>
        <Link href="/about" className="hover:text-ink transition-colors">
          About
        </Link>
      </nav>
    </header>
  );
}
