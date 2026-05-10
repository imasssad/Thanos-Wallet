'use client';
import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

interface ThemeCtx {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeCtx>({ theme: 'light', toggleTheme: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    // Default to LIGHT unless user explicitly chose dark previously
    const stored = localStorage.getItem('thanos-theme') as Theme | null;
    const resolved: Theme = stored === 'dark' ? 'dark' : 'light';
    setTheme(resolved);
    document.documentElement.dataset.theme = resolved;
  }, []);

  const toggleTheme = () => {
    setTheme(prev => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('thanos-theme', next);
      document.documentElement.dataset.theme = next;
      return next;
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
