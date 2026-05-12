'use client';
/**
 * Generic Radix-based Select.
 *
 * For non-token dropdowns (currency, language, lock-timeout, etc.) where
 * we want the same dark-themed dropdown styling as TokenSelect without the
 * TokenIcon. Built on the same primitive shadcn's Select uses, with our
 * custom inline styling.
 */
import React from 'react';
import * as RSelect from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectOption {
  /** Stored value */
  value: string;
  /** Optional display label — falls back to value */
  label?: string;
}

interface Props {
  value:    string;
  onChange: (v: string) => void;
  /** Either `string[]` (value === label) or `SelectOption[]`. */
  options:  Array<string | SelectOption>;
  ariaLabel?: string;
  /** Width override for the trigger. */
  width?:   React.CSSProperties['width'];
}

function normalize(opt: string | SelectOption): SelectOption {
  return typeof opt === 'string' ? { value: opt } : opt;
}

export function Select({ value, onChange, options, ariaLabel, width }: Props) {
  const opts = options.map(normalize);
  const selected = opts.find(o => o.value === value);

  return (
    <RSelect.Root value={value} onValueChange={onChange}>
      <RSelect.Trigger
        aria-label={ariaLabel ?? 'Select option'}
        className="settings-select"
        style={{
          display:        'flex',
          alignItems:     'center',
          gap:            8,
          width:          width ?? '100%',
          cursor:         'pointer',
          textAlign:      'left',
          appearance:     'none',
          backgroundImage:'none',
        }}
      >
        <RSelect.Value asChild>
          <span style={{ flex: 1, fontWeight: 500 }}>
            {selected?.label ?? selected?.value ?? value}
          </span>
        </RSelect.Value>
        <RSelect.Icon asChild>
          <ChevronDown size={14} strokeWidth={2} style={{ color: 'var(--text-muted)' }}/>
        </RSelect.Icon>
      </RSelect.Trigger>

      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={6}
          style={{
            zIndex:       100,
            background:   'var(--bg-elevated)',
            border:       '1px solid var(--border-default)',
            borderRadius: 10,
            padding:      4,
            minWidth:     'var(--radix-select-trigger-width)',
            maxHeight:    'min(300px, var(--radix-select-content-available-height))',
            boxShadow:    '0 10px 28px rgba(0,0,0,0.24)',
            overflow:     'hidden',
          }}
        >
          <RSelect.Viewport style={{ padding: 2 }}>
            {opts.map(o => (
              <RSelect.Item
                key={o.value}
                value={o.value}
                style={{
                  display:        'flex',
                  alignItems:     'center',
                  gap:            8,
                  padding:        '8px 10px',
                  borderRadius:   6,
                  cursor:         'pointer',
                  outline:        'none',
                  userSelect:     'none',
                  fontSize:       13,
                  fontWeight:     500,
                  color:          'var(--text-primary)',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <RSelect.ItemText asChild>
                  <span style={{ flex: 1 }}>{o.label ?? o.value}</span>
                </RSelect.ItemText>
                <RSelect.ItemIndicator>
                  <Check size={13} strokeWidth={2.5} style={{ color: 'var(--blue)' }}/>
                </RSelect.ItemIndicator>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}
