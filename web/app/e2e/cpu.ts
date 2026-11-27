// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The perf specs' long-task budgets (Review Focus 4: no main-thread task of
// 100 ms or more) are about the CI runner, a GitHub ubuntu VM some three to
// four times slower than a recent laptop. A budget met only on the faster
// machine passes locally and fails in CI. So the specs first slow the page
// to the runner's speed: a fixed benchmark is timed in the page, and
// Chromium's CPU throttling makes up the difference. On the runner, or
// anything slower, it is not throttled at all, so the budget is never
// eased; the rate and the benchmark go into the test's annotations.
// STARBOARD_CPU_RATE=<n> sets the rate instead, to profile at a fixed
// slowdown (#22 was reproduced at 4 to 6 times).

import type { Page, TestInfo } from "@playwright/test";

/** The benchmark's median on the CI runner, in ms (about 3.5 times a 2025 laptop's 25 ms). */
export const RUNNER_BENCH_MS = 90;
const MAX_RATE = 8;

/** bench is a fixed JavaScript workload's median time over five runs, in the page. */
async function bench(page: Page): Promise<number> {
  return page.evaluate(() => {
    const runs: number[] = [];
    for (let r = 0; r < 5; r++) {
      const t0 = performance.now();
      const a: number[] = [];
      for (let i = 0; i < 200_000; i++) a.push((i * 7919) % 10007);
      a.sort((p, q) => p - q);
      let x = 0;
      for (const v of a) x = (x + v) | 0;
      runs.push(performance.now() - t0 + (x & 0));
    }
    return runs.sort((p, q) => p - q)[2] ?? 0;
  });
}

/** runAtRunnerSpeed throttles page's CPU (Chromium) so it runs no faster than the CI runner, and returns the rate. */
export async function runAtRunnerSpeed(page: Page, info: TestInfo): Promise<number> {
  const measured = await bench(page);
  const fixed = Number(process.env["STARBOARD_CPU_RATE"] ?? "");
  const rate = fixed >= 1 ? fixed : Math.min(MAX_RATE, Math.max(1, RUNNER_BENCH_MS / Math.max(measured, 1)));
  if (rate > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  }
  const why = fixed >= 1 ? "as STARBOARD_CPU_RATE says" : `to the runner's ${RUNNER_BENCH_MS} ms`;
  info.annotations.push({ type: "cpu", description: `benchmark ${measured.toFixed(1)} ms; throttled ×${rate.toFixed(2)} ${why}` });
  return rate;
}
