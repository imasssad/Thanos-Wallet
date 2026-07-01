/**
 * Minimal, dependency-free circuit breaker (T3).
 *
 * Wraps calls to a flaky/slow external dependency so that, once it starts
 * failing or timing out, subsequent calls FAST-FAIL for a cooldown window
 * instead of every request paying the full timeout and piling up connections.
 * After the cooldown a single "half-open" trial is allowed; success closes the
 * breaker, another failure re-opens it — so a recovered dependency heals
 * automatically.
 *
 * Also bounds in-flight concurrency to a single dependency (maxConcurrent), so
 * a slow upstream can't accumulate unbounded pending requests holding event-loop
 * resources.
 *
 * The caller is expected to already have a per-call timeout (AbortController)
 * and a stale/degraded fallback in its catch block — the breaker only changes
 * WHEN the failure happens (immediately, once tripped) not WHAT the caller does
 * with it. A BreakerOpenError is thrown while open/saturated; catch it exactly
 * like any other upstream error.
 */

export class BreakerOpenError extends Error {
  constructor(dep: string) {
    super(`circuit_open:${dep}`);
    this.name = 'BreakerOpenError';
  }
}

export interface BreakerOptions {
  /** Consecutive failures before the breaker opens. Default 5. */
  failureThreshold?: number;
  /** How long to stay open before allowing a half-open trial (ms). Default 15s. */
  cooldownMs?: number;
  /** Max simultaneous in-flight calls to this dependency. Default 12. */
  maxConcurrent?: number;
}

type State = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private state: State = 'closed';
  private failures = 0;
  private openedAt = 0;
  private inFlight = 0;

  constructor(
    private readonly name: string,
    private readonly failureThreshold: number,
    private readonly cooldownMs: number,
    private readonly maxConcurrent: number,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.openedAt < this.cooldownMs) {
        // Still cooling down — fail immediately, don't touch the dependency.
        throw new BreakerOpenError(this.name);
      }
      // Cooldown elapsed — let ONE request through to test recovery.
      this.state = 'half-open';
    }

    // Bound concurrency so a slow dep can't pile up unbounded in-flight calls.
    if (this.inFlight >= this.maxConcurrent) {
      throw new BreakerOpenError(`${this.name}:saturated`);
    }

    this.inFlight++;
    try {
      const out = await fn();
      this.onSuccess();
      return out;
    } catch (err) {
      this.onFailure();
      throw err;
    } finally {
      this.inFlight--;
    }
  }

  private onSuccess(): void {
    if (this.state !== 'closed') {
      // eslint-disable-next-line no-console
      console.info(`[circuit] ${this.name} recovered — closing`);
    }
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.failures++;
    // A failed half-open trial, or crossing the threshold from closed, opens it.
    if (this.state === 'half-open' || this.failures >= this.failureThreshold) {
      if (this.state !== 'open') {
        // eslint-disable-next-line no-console
        console.warn(`[circuit] ${this.name} OPEN after ${this.failures} failures — fast-failing for ${this.cooldownMs}ms`);
      }
      this.state = 'open';
      this.openedAt = Date.now();
    }
  }

  get status() {
    return { name: this.name, state: this.state, failures: this.failures, inFlight: this.inFlight };
  }
}

/* One shared breaker per named dependency, so all callers of e.g. 'coingecko'
 * trip/​recover together. */
const registry = new Map<string, CircuitBreaker>();

export function breaker(name: string, opts: BreakerOptions = {}): CircuitBreaker {
  let b = registry.get(name);
  if (!b) {
    b = new CircuitBreaker(
      name,
      opts.failureThreshold ?? 5,
      opts.cooldownMs ?? 15_000,
      opts.maxConcurrent ?? 12,
    );
    registry.set(name, b);
  }
  return b;
}

/** Snapshot of every breaker's state — handy for a /metrics or /health probe. */
export function breakerStates() {
  return [...registry.values()].map(b => b.status);
}
