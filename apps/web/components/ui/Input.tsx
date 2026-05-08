'use client';
import React from 'react';
import styles from './Input.module.css';

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: string;
  hint?: string;
  error?: string;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
}

export function Input({ label, hint, error, prefix, suffix, className = '', ...props }: InputProps) {
  return (
    <div className={styles.wrapper}>
      {label && <label className={styles.label}>{label}</label>}
      <div className={[styles.inputWrap, error ? styles.hasError : ''].join(' ')}>
        {prefix && <span className={styles.prefix}>{prefix}</span>}
        <input {...props} className={[styles.input, className].join(' ')} />
        {suffix && <span className={styles.suffix}>{suffix}</span>}
      </div>
      {error && <p className={styles.error}>{error}</p>}
      {hint && !error && <p className={styles.hint}>{hint}</p>}
    </div>
  );
}
