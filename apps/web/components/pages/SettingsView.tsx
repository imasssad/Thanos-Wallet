'use client';
import React, { useState } from 'react';
import styles from './SettingsView.module.css';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { IconShield, IconNetwork, IconWallet, IconChevronRight, IconAlert, IconCheck } from '../ui/Icons';

interface ToggleProps { on: boolean; onChange: (v: boolean) => void; }

function Toggle({ on, onChange }: ToggleProps) {
  return (
    <button
      className={[styles.toggle, on ? styles.toggleOn : ''].join(' ')}
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
    >
      <span className={styles.toggleThumb} />
    </button>
  );
}

function SettingRow({
  label, description, children, danger
}: {
  label: string; description?: string; children?: React.ReactNode; danger?: boolean;
}) {
  return (
    <div className={[styles.row, danger ? styles.dangerRow : ''].join(' ')}>
      <div className={styles.rowInfo}>
        <span className={[styles.rowLabel, danger ? styles.dangerLabel : ''].join(' ')}>{label}</span>
        {description && <span className={styles.rowDesc}>{description}</span>}
      </div>
      {children && <div className={styles.rowAction}>{children}</div>}
    </div>
  );
}

function SettingGroup({ icon: Icon, title, children }: {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.group}>
      <div className={styles.groupHeader}>
        <Icon size={15} color="var(--purple-400)" />
        <span className={styles.groupTitle}>{title}</span>
      </div>
      <div className={styles.groupBody}>{children}</div>
    </div>
  );
}

export function SettingsView() {
  const [biometric, setBiometric]         = useState(true);
  const [autoLock, setAutoLock]           = useState(true);
  const [hideBalance, setHideBalance]     = useState(false);
  const [testnet, setTestnet]             = useState(true);
  const [analytics, setAnalytics]         = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [phraseCopied, setPhraseCopied]   = useState(false);

  function copyPhrase() {
    setPhraseCopied(true);
    setTimeout(() => setPhraseCopied(false), 2500);
  }

  return (
    <div className={styles.page + ' fade-in'}>
      <div className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.subtitle}>Manage your wallet preferences and security</p>
      </div>

      <div className={styles.sections}>
        <SettingGroup icon={IconShield} title="Security">
          <SettingRow label="Biometric unlock" description="Use Face ID or fingerprint to unlock">
            <Toggle on={biometric} onChange={setBiometric} />
          </SettingRow>
          <SettingRow label="Auto-lock" description="Lock wallet after 5 minutes of inactivity">
            <Toggle on={autoLock} onChange={setAutoLock} />
          </SettingRow>
          <SettingRow label="Hide balance" description="Mask balance on the home screen">
            <Toggle on={hideBalance} onChange={setHideBalance} />
          </SettingRow>
          <SettingRow
            label="Export recovery phrase"
            description="View your 12-word seed phrase — store it safely"
            danger
          >
            <Button variant="danger" size="sm" icon={phraseCopied ? <IconCheck size={13}/> : undefined} onClick={copyPhrase}>
              {phraseCopied ? 'Revealed' : 'Reveal'}
            </Button>
          </SettingRow>
        </SettingGroup>

        <SettingGroup icon={IconNetwork} title="Network">
          <SettingRow label="Show testnets" description="Enable Makalu testnet and Kamet testnet">
            <Toggle on={testnet} onChange={setTestnet} />
          </SettingRow>
          <SettingRow label="Active network">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Badge variant="green" dot>Makalu</Badge>
              <IconChevronRight size={14} color="var(--text-muted)" />
            </div>
          </SettingRow>
          <SettingRow label="RPC endpoints" description="Custom RPC providers per chain">
            <Button variant="ghost" size="sm">
              Manage <IconChevronRight size={13} />
            </Button>
          </SettingRow>
        </SettingGroup>

        <SettingGroup icon={IconWallet} title="Wallet">
          <SettingRow label="Connected dApps" description="Manage WalletConnect sessions">
            <Button variant="ghost" size="sm">
              View <IconChevronRight size={13} />
            </Button>
          </SettingRow>
          <SettingRow label="Analytics" description="Anonymous usage data to improve the wallet">
            <Toggle on={analytics} onChange={setAnalytics} />
          </SettingRow>
          <SettingRow label="Push notifications">
            <Toggle on={notifications} onChange={setNotifications} />
          </SettingRow>
        </SettingGroup>

        <SettingGroup icon={IconAlert} title="Danger zone">
          <SettingRow label="Reset wallet" description="Remove all accounts and start fresh" danger>
            <Button variant="danger" size="sm">Reset</Button>
          </SettingRow>
        </SettingGroup>

        <p className={styles.version}>Thanos Wallet v0.8.1 · Makalu Sync · © 2025 Lithosphere</p>
      </div>
    </div>
  );
}
