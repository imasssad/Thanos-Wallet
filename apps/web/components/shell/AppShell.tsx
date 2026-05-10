'use client';
import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Image from 'next/image';
import { useTheme } from '../providers/ThemeProvider';
import { TopNav } from './TopNav';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopNav/>
      <main style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {children}
      </main>
    </div>
  );
}
