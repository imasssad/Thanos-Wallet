import React, { Suspense } from 'react';
import { Dashboard } from '../../components/dashboard';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  );
}
