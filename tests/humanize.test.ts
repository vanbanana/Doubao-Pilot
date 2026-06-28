import { describe, expect, it } from 'vitest';
import { RequestPacer } from '../src/core/agent/humanize';

describe('RequestPacer.computeDelay', () => {
  it('always waits at least the base minimum gap', () => {
    const pacer = new RequestPacer({ rng: () => 0, longPauseChance: 0 });
    expect(pacer.computeDelay(0, null)).toBeGreaterThanOrEqual(700);
  });

  it('adds reading time proportional to context length, capped', () => {
    const pacer = new RequestPacer({ rng: () => 0, thinkMsPerChar: 2, maxThinkMs: 1000, longPauseChance: 0 });
    const small = pacer.computeDelay(100, null); // 700 base + 200 think
    const huge = pacer.computeDelay(100000, null); // think capped at 1000
    expect(small).toBe(900);
    expect(huge).toBe(1700);
  });

  it('applies an occasional long pause when the pause roll succeeds', () => {
    // Sequenced rng: same base roll (0.5), then differing pause-decision rolls.
    const seq = (values: number[]) => {
      let i = 0;
      return () => values[i++ % values.length]!;
    };
    const withPause = new RequestPacer({
      rng: seq([0.5, 0.05, 0.5]), // base, pause-hit, pause-magnitude
      longPauseChance: 0.15,
      longPauseMs: 3000,
    });
    const noPause = new RequestPacer({
      rng: seq([0.5, 0.9]), // base, pause-miss
      longPauseChance: 0.15,
      longPauseMs: 3000,
    });
    expect(withPause.computeDelay(0, null)).toBeGreaterThan(noPause.computeDelay(0, null));
  });

  it('enforces the minimum gap relative to the previous request', () => {
    const pacer = new RequestPacer({ rng: () => 0, minGapMs: 1000, baseMaxMs: 1000, longPauseChance: 0 });
    // Only 200ms since last request → must wait at least the remaining 800ms.
    expect(pacer.computeDelay(0, 200)).toBeGreaterThanOrEqual(800);
  });

  it('does not over-wait when enough time has already passed', () => {
    const pacer = new RequestPacer({ rng: () => 0, minGapMs: 1000, baseMaxMs: 1000, thinkMsPerChar: 0, longPauseChance: 0 });
    expect(pacer.computeDelay(0, 5000)).toBe(1000);
  });
});

describe('RequestPacer.pace', () => {
  it('sleeps the computed delay and records request time', async () => {
    const slept: number[] = [];
    let clock = 0;
    const pacer = new RequestPacer({
      rng: () => 0,
      longPauseChance: 0,
      thinkMsPerChar: 0,
      now: () => clock,
      sleep: (ms) => {
        slept.push(ms);
        clock += ms;
        return Promise.resolve();
      },
    });

    const first = await pacer.pace(0);
    expect(first).toBeGreaterThanOrEqual(700);
    expect(slept).toHaveLength(1);

    // Immediately pacing again must still honour the minimum gap.
    const second = await pacer.pace(0);
    expect(second).toBeGreaterThan(0);
  });
});
