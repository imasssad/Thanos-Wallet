import React from 'react';
import { AppShell } from '../../components/shell/AppShell';

// Rendered per request so Next can stamp middleware.ts's CSP nonce on its
// scripts — a pre-rendered page carries none and would be blocked.
export const dynamic = 'force-dynamic';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
