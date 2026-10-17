/**
 * Building blocks for the Thanos MultiSig screens. Styled by styles.css with the palette every
 * Thanos client defines (--bg-card, --text-primary, --blue, …), so the screens look native in the
 * web app, the extension popup and the desktop app alike.
 */
import React, { useState } from 'react';
import { isAnyAddress, parseAddress, toLithoAddress } from '@litho-vault/sdk';

type Children = { children?: React.ReactNode };

export function Icon({ name, size = 18 }: { name: 'back' | 'plus' | 'copy' | 'check' | 'link' | 'shield' | 'users' | 'send' | 'alert' | 'refresh'; size?: number }) {
  const paths: Record<typeof name, React.ReactNode> = {
    back: <path d="M15 18l-6-6 6-6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    copy: (
      <>
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V6a2 2 0 0 1 2-2h9" />
      </>
    ),
    check: <path d="M20 6L9 17l-5-5" />,
    link: <path d="M14 4h6v6M10 14L20 4M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
    shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />,
    users: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.8a3.5 3.5 0 0 1 0 6.4M18.5 14.8c1.6.8 2.6 2.6 3 5.2" />
      </>
    ),
    send: <path d="M7 17L17 7M9 7h8v8" />,
    alert: <path d="M12 9v4M12 17h.01M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />,
    refresh: <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export function Screen({ title, subtitle, onBack, actions, children }: Children & { title: React.ReactNode; subtitle?: React.ReactNode; onBack?: () => void; actions?: React.ReactNode }) {
  return (
    <section className="tms-screen">
      <header className="tms-header">
        {onBack && (
          <button type="button" className="tms-icon-btn" onClick={onBack} aria-label="Back" data-testid="tms-back">
            <Icon name="back" />
          </button>
        )}
        <div className="tms-header-text">
          <h1 className="tms-title">{title}</h1>
          {subtitle && <div className="tms-subtitle">{subtitle}</div>}
        </div>
        {actions && <div className="tms-header-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function Card({ title, aside, children, testId }: Children & { title?: React.ReactNode; aside?: React.ReactNode; testId?: string }) {
  return (
    <div className="tms-card" data-testid={testId}>
      {(title || aside) && (
        <div className="tms-card-head">
          {title && <h2 className="tms-card-title">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </div>
  );
}

export function Button({
  kind = 'secondary',
  children,
  disabled,
  onClick,
  testId,
  type = 'button',
}: Children & { kind?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; onClick?: () => void; testId?: string; type?: 'button' | 'submit' }) {
  return (
    <button type={type} className={`tms-btn tms-btn-${kind}`} disabled={disabled} onClick={onClick} data-testid={testId}>
      {children}
    </button>
  );
}

export type Tone = 'neutral' | 'info' | 'good' | 'warn' | 'bad';

export function Pill({ tone = 'neutral', children, testId }: Children & { tone?: Tone; testId?: string }) {
  return (
    <span className={`tms-pill tms-pill-${tone}`} data-testid={testId}>
      {children}
    </span>
  );
}

export function Notice({ tone = 'info', children, testId }: Children & { tone?: Exclude<Tone, 'neutral'>; testId?: string }) {
  return (
    <div className={`tms-notice tms-notice-${tone}`} role={tone === 'bad' ? 'alert' : undefined} data-testid={testId}>
      {(tone === 'warn' || tone === 'bad') && <Icon name="alert" size={16} />}
      <div>{children}</div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="tms-loading" role="status">
      <span className="tms-spinner" aria-hidden="true" />
      {label && <span>{label}</span>}
    </div>
  );
}

export function ErrorText({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <Notice tone="bad" testId="tms-error">
      {error}
    </Notice>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="tms-icon-btn tms-icon-btn-sm"
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      <Icon name={done ? 'check' : 'copy'} size={14} />
    </button>
  );
}

/**
 * An address as Thanos shows it: litho1… for everything (people, the multisig itself, tokens).
 * 0x… is the secondary form: its own line under the litho1 address in full views, and the "0x"
 * switch in compact ones. The copy button copies the form shown.
 */
export function AddressText({ address, full = false, testId }: { address: string; full?: boolean; testId?: string }) {
  const [showEvm, setShowEvm] = useState(false);
  const parsed = parseAddress(address);
  if (!parsed) return <span className="tms-mono">{address}</span>;
  const litho = toLithoAddress(parsed);
  if (full) {
    return (
      <span className="tms-address tms-address-full" title={`${litho}\n${parsed}`} data-testid={testId}>
        <span className="tms-address-line">
          <span className="tms-mono" data-testid={testId ? `${testId}-litho` : undefined}>{litho}</span>
          <CopyButton text={litho} label="Copy litho1 address" />
        </span>
        <span className="tms-address-line tms-address-evm">
          <span className="tms-mono" data-testid={testId ? `${testId}-evm` : undefined}>{parsed}</span>
          <CopyButton text={parsed} label="Copy 0x address" />
        </span>
      </span>
    );
  }
  const shown = showEvm ? parsed : litho;
  const short = showEvm ? `${parsed.slice(0, 8)}…${parsed.slice(-6)}` : `${litho.slice(0, 12)}…${litho.slice(-6)}`;
  return (
    <span className="tms-address" title={`${litho}\n${parsed}`} data-testid={testId}>
      <span className="tms-mono">{short}</span>
      <CopyButton text={shown} label="Copy address" />
      <button type="button" className="tms-address-switch" aria-pressed={showEvm} title={showEvm ? 'Show the litho1 address' : 'Show the 0x address'} onClick={() => setShowEvm((x) => !x)}>
        {showEvm ? 'litho1' : '0x'}
      </button>
    </span>
  );
}

export function Field({ label, hint, children, error }: Children & { label: string; hint?: React.ReactNode; error?: string | null }) {
  return (
    <label className="tms-field">
      <span className="tms-field-label">{label}</span>
      {children}
      {error ? <span className="tms-field-error">{error}</span> : hint ? <span className="tms-field-hint">{hint}</span> : null}
    </label>
  );
}

/** An address input that takes litho1… or 0x… and shows the other form of what was typed. */
export function AddressInput({ value, onChange, placeholder, testId }: { value: string; onChange: (v: string) => void; placeholder?: string; testId?: string }) {
  const parsed = value.trim() ? parseAddress(value) : null;
  const hint = parsed ? (value.trim().toLowerCase().startsWith('litho1') ? `EVM: ${parsed}` : toLithoAddress(parsed)) : null;
  return (
    <span className="tms-address-input">
      <input
        className="tms-input tms-mono"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'litho1… or 0x…'}
        spellCheck={false}
        autoComplete="off"
        data-testid={testId}
      />
      {value.trim() && !isAnyAddress(value) ? (
        <span className="tms-field-error">Not a valid address</span>
      ) : hint ? (
        <span className="tms-field-hint tms-mono" data-testid={testId ? `${testId}-hint` : undefined}>
          {hint}
        </span>
      ) : null}
    </span>
  );
}

export function KeyValue({ rows, testId }: { rows: { key: string; label: string; value: React.ReactNode; tone?: Tone }[]; testId?: string }) {
  return (
    <dl className="tms-kv" data-testid={testId}>
      {rows.map((r) => (
        <div className={`tms-kv-row ${r.tone ? `tms-kv-${r.tone}` : ''}`} key={r.key} data-testid={`tms-field-${r.key}`}>
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
