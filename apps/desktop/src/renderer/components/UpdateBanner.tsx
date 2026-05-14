/**
 * Auto-update banner — subscribes to the `updater:event` IPC stream
 * exposed by preload.ts and renders a thin bar above the topnav when
 * there's something to communicate.
 *
 * States:
 *   - hidden    (initial / not-available)
 *   - checking  (no banner — silent network call)
 *   - available + downloading (shows percent)
 *   - downloaded (shows "Restart to install" CTA)
 *   - error     (red banner with retry)
 *
 * Bandwidth note: autoDownload is on in src/main/updater.ts, so the
 * "available" state typically transitions through "progress" without
 * the user clicking anything. If we move that to opt-in in a future
 * iteration, the banner here grows a "Download" button — the IPC
 * shape doesn't change.
 */
import React, { useEffect, useState } from 'react';

type UpdaterEvent =
  | { kind: 'checking' }
  | { kind: 'available';   version: string; releaseNotes?: string | null }
  | { kind: 'not-available' }
  | { kind: 'progress';    percent: number; transferred: number; total: number; bytesPerSecond: number }
  | { kind: 'downloaded';  version: string; releaseNotes?: string | null }
  | { kind: 'error';       message: string };

interface DesktopApi {
  onUpdateEvent?:     (cb: (ev: UpdaterEvent) => void) => () => void;
  checkForUpdate?:    () => Promise<unknown>;
  installAndRestart?: () => Promise<unknown>;
}

/* The full window.thanosDesktop type is declared once in main.tsx so
   the merge stays consistent; here we just cast through DesktopApi
   when we need the updater bits. */
function desktopApi(): DesktopApi | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { thanosDesktop?: DesktopApi }).thanosDesktop ?? null;
}

type State =
  | { kind: 'hidden' }
  | { kind: 'progress';    version?: string; percent: number }
  | { kind: 'downloaded';  version: string }
  | { kind: 'error';       message: string };

export function UpdateBanner() {
  const [state, setState] = useState<State>({ kind: 'hidden' });
  const [version, setVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const api = desktopApi();
    if (!api?.onUpdateEvent) return;
    const off = api.onUpdateEvent(ev => {
      switch (ev.kind) {
        case 'checking':
        case 'not-available':
          // Silent — don't yank the user's attention for these.
          break;
        case 'available':
          setVersion(ev.version);
          setState({ kind: 'progress', version: ev.version, percent: 0 });
          setDismissed(false);
          break;
        case 'progress':
          setState(prev => ({
            kind:    'progress',
            version: prev.kind === 'progress' ? prev.version : version ?? undefined,
            percent: Math.max(0, Math.min(100, ev.percent)),
          }));
          break;
        case 'downloaded':
          setState({ kind: 'downloaded', version: ev.version });
          setDismissed(false);
          break;
        case 'error':
          setState({ kind: 'error', message: ev.message });
          break;
        // No default — forward-compat with future event kinds.
      }
    });
    return off;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.kind === 'hidden' || dismissed) return null;

  const onInstall = () => { desktopApi()?.installAndRestart?.(); };
  const onRetry   = () => { void desktopApi()?.checkForUpdate?.(); setState({ kind: 'hidden' }); };

  const bg =
    state.kind === 'error'      ? 'rgba(239,68,68,0.12)'  :
    state.kind === 'downloaded' ? 'rgba(16,185,129,0.14)' :
                                  'rgba(59,122,247,0.14)';
  const fg =
    state.kind === 'error'      ? 'var(--red)'    :
    state.kind === 'downloaded' ? 'var(--green)'  :
                                  'var(--blue)';
  const border =
    state.kind === 'error'      ? 'rgba(239,68,68,0.30)'  :
    state.kind === 'downloaded' ? 'rgba(16,185,129,0.30)' :
                                  'rgba(59,122,247,0.30)';

  return (
    <div role={state.kind === 'error' ? 'alert' : 'status'} style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '8px 18px',
      background: bg,
      borderBottom: `1px solid ${border}`,
      color: 'var(--text-primary)',
      fontSize: 12, lineHeight: 1.3,
    }}>
      <span style={{ color: fg, fontWeight: 700 }}>
        {state.kind === 'progress'   && `Downloading update ${state.version ? `v${state.version} ` : ''}— ${state.percent.toFixed(0)}%`}
        {state.kind === 'downloaded' && `Update v${state.version} ready to install`}
        {state.kind === 'error'      && 'Update failed'}
      </span>
      {state.kind === 'error' && (
        <span style={{ color: 'var(--text-secondary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {state.message}
        </span>
      )}
      {state.kind === 'progress' && (
        <div style={{ flex: 1, height: 4, background: 'var(--bg-elevated)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{
            width: `${state.percent}%`, height: '100%',
            background: 'var(--blue)', transition: 'width 250ms ease',
          }}/>
        </div>
      )}

      {state.kind === 'downloaded' && (
        <button onClick={onInstall} style={{
          padding: '4px 10px', borderRadius: 6,
          background: 'var(--green)', color: 'white',
          border: 'none', fontSize: 11, fontWeight: 700, cursor: 'pointer',
        }}>
          Restart &amp; install
        </button>
      )}
      {state.kind === 'error' && (
        <button onClick={onRetry} style={{
          padding: '4px 10px', borderRadius: 6,
          background: 'transparent', color: 'var(--red)',
          border: '1px solid var(--red)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
        }}>
          Retry
        </button>
      )}
      <button
        onClick={() => setDismissed(true)}
        title="Dismiss"
        aria-label="Dismiss update banner"
        style={{
          background: 'transparent', border: 'none', color: 'var(--text-muted)',
          fontSize: 16, cursor: 'pointer', padding: '0 2px',
        }}
      >
        ✕
      </button>
    </div>
  );
}
