// Anti-detection request pacing.
//
// 豆包 watches for bot-like cadence: a burst of /chat/completion requests fired
// milliseconds apart (which is what a naive agent loop produces after each tool
// finishes) is a strong automation signal that can trigger human verification.
// This module spaces continuation requests out the way a person would — a base
// gap with random jitter, plus extra "reading time" proportional to how much
// new context (tool output) the model has to absorb, and an occasional longer
// pause. Timing is the only thing humanized here; request bytes stay identical
// to the page's own (see buildDoubaoContinuationBody).

export interface PacerOptions {
  /** Hard minimum spacing between two consecutive requests. */
  minGapMs?: number;
  /** Upper bound of the uniformly-random base delay. */
  baseMaxMs?: number;
  /** Simulated reading speed for new context (ms per character). */
  thinkMsPerChar?: number;
  /** Cap on the simulated reading time. */
  maxThinkMs?: number;
  /** Probability [0,1] of an occasional longer "distracted" pause. */
  longPauseChance?: number;
  /** Extra delay range applied when a long pause triggers. */
  longPauseMs?: number;
  rng?: () => number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULTS = {
  minGapMs: 700,
  baseMaxMs: 1600,
  thinkMsPerChar: 1.2,
  maxThinkMs: 2500,
  longPauseChance: 0.15,
  longPauseMs: 2500,
} satisfies Required<Omit<PacerOptions, 'rng' | 'now' | 'sleep'>>;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class RequestPacer {
  private readonly opts: Required<Omit<PacerOptions, 'rng' | 'now' | 'sleep'>>;
  private readonly rng: () => number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private lastRequestAt: number | null = null;

  constructor(options: PacerOptions = {}) {
    this.opts = {
      minGapMs: options.minGapMs ?? DEFAULTS.minGapMs,
      baseMaxMs: options.baseMaxMs ?? DEFAULTS.baseMaxMs,
      thinkMsPerChar: options.thinkMsPerChar ?? DEFAULTS.thinkMsPerChar,
      maxThinkMs: options.maxThinkMs ?? DEFAULTS.maxThinkMs,
      longPauseChance: options.longPauseChance ?? DEFAULTS.longPauseChance,
      longPauseMs: options.longPauseMs ?? DEFAULTS.longPauseMs,
    };
    this.rng = options.rng ?? Math.random;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /**
   * Pure delay computation (no side effects) so behaviour is unit-testable.
   * `contextLength` is the size of the new material the model must read before
   * replying (e.g. the continuation prompt with tool results).
   */
  computeDelay(contextLength: number, sinceLastMs: number | null): number {
    const base = this.opts.minGapMs + this.rng() * (this.opts.baseMaxMs - this.opts.minGapMs);
    const think = Math.min(Math.max(0, contextLength) * this.opts.thinkMsPerChar, this.opts.maxThinkMs);
    const longPause = this.rng() < this.opts.longPauseChance ? this.rng() * this.opts.longPauseMs : 0;
    let delay = base + think + longPause;

    // Enforce the minimum gap relative to the previous request.
    if (sinceLastMs !== null && sinceLastMs < this.opts.minGapMs) {
      delay = Math.max(delay, this.opts.minGapMs - sinceLastMs);
    }
    return Math.round(delay);
  }

  /** Waits the humanized interval, then records the request time. */
  async pace(contextLength: number): Promise<number> {
    const sinceLast = this.lastRequestAt === null ? null : this.now() - this.lastRequestAt;
    const delay = this.computeDelay(contextLength, sinceLast);
    if (delay > 0) await this.sleep(delay);
    this.lastRequestAt = this.now();
    return delay;
  }
}
