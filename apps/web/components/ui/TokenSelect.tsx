'use client';
/**
 * TokenSelect — Radix-based dropdown that shows TokenIcon + symbol on the
 * trigger and in each option row.
 *
 * Uses @radix-ui/react-select (the same primitive shadcn/ui's Select is
 * built on). Styling is inline / via existing CSS variables so it matches
 * the wallet's design system without dragging in Tailwind.
 *
 * Drop-in replacement for the native <select> + <option> we had in modals:
 *
 *   <TokenSelect
 *     value={coin}
 *     onChange={setCoin}
 *     options={TOKEN_SYMBOLS}
 *   />
 */
import React from 'react';
import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { TokenIcon } from '../TokenIcon';

interface Props {
  value:   string;
  onChange:(sym: string) => void;
  options: string[];                  // list of symbols
  /** Width override — defaults to fill container. */
  width?:  React.CSSProperties['width'];
  /** Optional aria-label for the trigger. */
  ariaLabel?: string;
}

export function TokenSelect({ value, onChange, options, width, ariaLabel }: Props) {
  return (
    <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger
        aria-label={ariaLabel ?? 'Select token'}
        className="field-select"
        style={{
          display:        'flex',
          alignItems:     'center',
          gap:            10,
          width:          width ?? '100%',
          cursor:         'pointer',
          textAlign:      'left',
          // Override the native-select-only styles in the existing class
          appearance:     'none',
          backgroundImage:'none',
        }}
      >
        <TokenIcon sym={value} size={22}/>
        <Select.Value asChild>
          <span style={{ flex: 1, fontWeight: 600 }}>{value}</span>
        </Select.Value>
        <Select.Icon asChild>
          <ChevronDown size={16} strokeWidth={2} style={{ color: 'var(--text-muted)' }}/>
        </Select.Icon>
      </Select.Trigger>

      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={6}
          className="card"
          style={{
            zIndex:         100,
            background:     'var(--bg-elevated)',
            border:         '1px solid var(--border-default)',
            borderRadius:   12,
            padding:        4,
            minWidth:       'var(--radix-select-trigger-width)',
            maxHeight:      'min(360px, var(--radix-select-content-available-height))',
            boxShadow:      '0 10px 28px rgba(0,0,0,0.24)',
            overflow:       'hidden',
          }}
        >
          <Select.Viewport style={{ padding: 2 }}>
            {options.map(sym => (
              <Select.Item
                key={sym}
                value={sym}
                style={{
                  display:        'flex',
                  alignItems:     'center',
                  gap:            10,
                  padding:        '8px 10px',
                  borderRadius:   8,
                  cursor:         'pointer',
                  outline:        'none',
                  userSelect:     'none',
                  fontSize:       13,
                  fontWeight:     500,
                  color:          'var(--text-primary)',
                }}
                /* Radix sets data-highlighted on hover/keyboard focus.
                   We restyle that here. */
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <TokenIcon sym={sym} size={22}/>
                <Select.ItemText asChild>
                  <span style={{ flex: 1 }}>{sym}</span>
                </Select.ItemText>
                <Select.ItemIndicator>
                  <Check size={14} strokeWidth={2.5} style={{ color: 'var(--blue)' }}/>
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
