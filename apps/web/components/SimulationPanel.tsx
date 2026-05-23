'use client';
/**
 * SimulationPanel — renders a SimulationReport from
 * `lib/simulation.ts`. Shows non-info issues with appropriate
 * iconography + colour, and the human-readable summary line. The
 * approval surface (Send modal, WC sheet, EIP-1193 popup) drives this
 * by passing in the latest report; the panel itself does no fetching.
 *
 * Layout matches the existing PhishingBanner so the two stack neatly:
 * one badge per row, compact, no scroll.
 */
import React from 'react';
import { AlertTriangle, Info, ShieldAlert } from 'lucide-react';
import type { SimulationReport, SimulationIssue } from '../lib/simulation';

const LEVEL_STYLE: Record<SimulationIssue['level'], { color: string; bg: string; icon: React.ElementType }> = {
  info:     { color: 'var(--text-muted)', bg: 'transparent',                 icon: Info },
  warning:  { color: 'var(--orange)',     bg: 'rgba(247, 144, 9, 0.10)',     icon: AlertTriangle },
  critical: { color: 'var(--red)',        bg: 'rgba(239, 68, 68, 0.10)',     icon: ShieldAlert },
};

interface Props {
  report:      SimulationReport | null;
  /** When true, also show info-level issues. Approval sheets usually
   *  want to suppress info noise; debug/dev surfaces can show them. */
  showInfo?:   boolean;
  /** Compact mode — drop the summary line and only show issues. Useful
   *  in the EIP-1193 popup approval sheet where space is tight. */
  compact?:    boolean;
}

export function SimulationPanel({ report, showInfo = false, compact = false }: Props) {
  if (!report) return null;

  const issues = report.issues.filter(i => showInfo || i.level !== 'info');
  if (issues.length === 0 && compact) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
      {!compact && (
        <div style={{
          fontSize: 12,
          color: 'var(--text-muted)',
          padding: '6px 10px',
          background: 'var(--bg-subtle, rgba(0,0,0,0.04))',
          borderRadius: 8,
          fontFamily: 'Geist Mono, monospace',
        }}>
          {report.summary}
        </div>
      )}
      {issues.map((issue, i) => {
        const style = LEVEL_STYLE[issue.level];
        const Icon  = style.icon;
        return (
          <div
            key={`${issue.code}-${i}`}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 8,
              background: style.bg,
              border: issue.level === 'critical' ? '1px solid var(--red)' : 'none',
              fontSize: 12,
              color: style.color,
            }}
          >
            <Icon size={14} style={{ flexShrink: 0, marginTop: 1 }}/>
            <span style={{ lineHeight: 1.4 }}>{issue.message}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Convenience: returns true if any issue in the report is critical
 *  level, used by approval surfaces to gate the primary action. */
export function hasCriticalIssue(report: SimulationReport | null): boolean {
  return !!report?.issues.some(i => i.level === 'critical');
}
