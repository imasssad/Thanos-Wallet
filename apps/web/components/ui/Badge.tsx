'use client';
import React from 'react';
import styles from './Badge.module.css';

type BadgeVariant = 'default' | 'green' | 'red' | 'yellow' | 'blue' | 'purple';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  dot?: boolean;
}

export function Badge({ children, variant = 'default', dot = false }: BadgeProps) {
  return (
    <span className={[styles.badge, styles[variant]].join(' ')}>
      {dot && <span className={styles.dot} />}
      {children}
    </span>
  );
}
