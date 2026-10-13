import type { DetailFetchResult, Item, ItemDetails } from '../vinted/types';

// Fetches item pages one at a time with a jittered delay, and stops on the
// first sign of blocking (RESEARCH.md D2, §6). The queue asks for its next
// item each time, so narrowing the filters mid-run takes effect immediately.

export type QueueStatus =
  | { state: 'idle' }
  | { state: 'running'; done: number; remaining: number }
  | { state: 'paused'; reason: string; blocked: boolean }
  | { state: 'finished'; done: number };

export interface DetailQueueDeps {
  fetchDetails: (item: Item, signal: AbortSignal) => Promise<DetailFetchResult>;
  saveDetails: (d: ItemDetails) => Promise<void>;
  /** Returns the items that still need details, in the order to fetch them. */
  nextBatch: () => Item[];
  onDetails: (d: ItemDetails) => void;
  onStatus: (s: QueueStatus) => void;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  baseDelayMs?: number;
  random?: () => number;
}

export class DetailQueue {
  private controller: AbortController | null = null;
  private delayMs: number;
  private done = 0;
  /** Items that failed for non-blocking reasons this run; not retried until restart. */
  private skipped = new Set<number>();

  constructor(private deps: DetailQueueDeps) {
    this.delayMs = deps.baseDelayMs ?? 2500;
  }

  get running(): boolean {
    return this.controller !== null;
  }

  /** Current delay between requests; doubles after each block. */
  get currentDelayMs(): number {
    return this.delayMs;
  }

  start(): void {
    if (this.controller) return;
    this.controller = new AbortController();
    this.done = 0;
    this.skipped.clear();
    void this.run(this.controller.signal);
  }

  stop(reason = 'Stopped.'): void {
    if (!this.controller) return;
    this.controller.abort();
    this.controller = null;
    this.deps.onStatus({ state: 'paused', reason, blocked: false });
  }

  private remaining(): Item[] {
    return this.deps.nextBatch().filter((i) => !this.skipped.has(i.id));
  }

  private async run(signal: AbortSignal): Promise<void> {
    const random = this.deps.random ?? Math.random;
    let first = true;
    try {
      for (;;) {
        const queue = this.remaining();
        if (queue.length === 0) break;
        this.deps.onStatus({ state: 'running', done: this.done, remaining: queue.length });
        if (!first) {
          // ±30% jitter so requests don't arrive on a fixed beat.
          await this.deps.sleep(this.delayMs * (0.7 + random() * 0.6), signal);
          if (signal.aborted) return;
        }
        first = false;
        // Re-read after the wait: filters may have changed.
        const item = this.remaining()[0];
        if (!item) break;
        let result: DetailFetchResult;
        try {
          result = await this.deps.fetchDetails(item, signal);
        } catch (err) {
          if (signal.aborted) return;
          this.skipped.add(item.id);
          console.warn('[vinted-seller-filters] item page failed', item.id, err);
          continue;
        }
        if (signal.aborted) return;
        if (result.kind === 'blocked') {
          this.delayMs *= 2;
          this.controller = null;
          this.deps.onStatus({ state: 'paused', reason: result.reason, blocked: true });
          return;
        }
        await this.deps.saveDetails(result.details);
        this.done++;
        this.deps.onDetails(result.details);
      }
      this.controller = null;
      this.deps.onStatus({ state: 'finished', done: this.done });
    } catch (err) {
      // Only aborts reach here (sleep rejects on abort).
      if (!signal.aborted) {
        this.controller = null;
        this.deps.onStatus({ state: 'paused', reason: String(err), blocked: false });
      }
    }
  }
}
