'use client';
/**
 * Mobile bottom tab bar — Trust Wallet-style. Hidden on desktop (see
 * .bottom-nav media query in globals.css); on phones it replaces the
 * hamburger drawer as the primary navigation for the five most-used
 * destinations. Rendered as a flex item in AppShell (not fixed) so it
 * never overlaps scrolling content.
 */
import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Home, Repeat, Coins, Compass, Clock } from 'lucide-react';

const ITEMS = [
  { href: '/app',           label: 'Home',     icon: Home,    match: (p: string) => p === '/app' },
  { href: '/app?swap=1',    label: 'Swap',     icon: Repeat,  match: () => false },
  { href: '/app/staking',   label: 'Earn',     icon: Coins,   match: (p: string) => p.startsWith('/app/staking') },
  { href: '/app/discover',  label: 'Discover', icon: Compass, match: (p: string) => p.startsWith('/app/discover') },
  { href: '/app/history',   label: 'Activity', icon: Clock,   match: (p: string) => p.startsWith('/app/history') },
];

export function BottomNav() {
  const router   = useRouter();
  const pathname = usePathname();

  return (
    <nav className="bottom-nav" aria-label="Primary">
      {ITEMS.map(({ href, label, icon: Icon, match }) => {
        const active = match(pathname);
        return (
          <button
            key={label}
            type="button"
            className={`bottom-nav-item ${active ? 'active' : ''}`}
            onClick={() => router.push(href)}
          >
            <Icon size={22} strokeWidth={active ? 2.4 : 2}/>
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
