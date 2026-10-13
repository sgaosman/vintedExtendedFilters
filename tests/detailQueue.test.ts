import { describe, expect, it, vi } from 'vitest';
import { DetailQueue, type QueueStatus } from '../src/core/detailQueue';
import type { DetailFetchResult, Item, ItemDetails } from '../src/vinted/types';

const mk = (id: number): Item => ({
  id,
  title: `t${id}`,
  url: `https://www.vinted.co.uk/items/${id}`,
  price: 1,
  totalPrice: 1,
  currency: 'GBP',
  brand: '',
  size: '',
  condition: '',
  thumb: '',
  favourites: 0,
  reserved: false,
  rank: id,
});
const ok = (id: number): DetailFetchResult => ({
  kind: 'ok',
  details: { id, colors: ['Blue'], materials: [], patterns: [], attributes: {}, fetchedAt: 0 },
});

function setup(fetchImpl: (item: Item) => Promise<DetailFetchResult>, ids = [1, 2, 3]) {
  const have = new Set<number>();
  let pool = ids.map(mk);
  const statuses: QueueStatus[] = [];
  const sleep = vi.fn().mockResolvedValue(undefined);
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));
  const queue = new DetailQueue({
    fetchDetails: vi.fn((item: Item) => fetchImpl(item)),
    saveDetails: vi.fn().mockResolvedValue(undefined),
    nextBatch: () => pool.filter((i) => !have.has(i.id)),
    onDetails: (d: ItemDetails) => have.add(d.id),
    onStatus: (s) => {
      statuses.push(s);
      if (s.state === 'finished' || s.state === 'paused') resolveDone();
    },
    sleep,
    baseDelayMs: 1000,
    random: () => 0.5,
  });
  return { queue, statuses, sleep, have, done, setPool: (next: number[]) => (pool = next.map(mk)) };
}

describe('DetailQueue', () => {
  it('fetches every pending item, sleeping between requests', async () => {
    const t = setup(async (item) => ok(item.id));
    t.queue.start();
    await t.done;
    expect([...t.have]).toEqual([1, 2, 3]);
    expect(t.sleep).toHaveBeenCalledTimes(2);
    expect(t.sleep.mock.calls[0]![0]).toBe(1000);
    expect(t.statuses.at(-1)).toEqual({ state: 'finished', done: 3 });
    expect(t.queue.running).toBe(false);
  });

  it('stops on the first blocked response and doubles the delay', async () => {
    const t = setup(async (item) => (item.id === 2 ? { kind: 'blocked', reason: 'challenge' } : ok(item.id)));
    t.queue.start();
    await t.done;
    expect([...t.have]).toEqual([1]);
    expect(t.statuses.at(-1)).toEqual({ state: 'paused', reason: 'challenge', blocked: true });
    expect(t.queue.currentDelayMs).toBe(2000);
    expect(t.queue.running).toBe(false);
  });

  it('skips items that throw and carries on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = setup(async (item) => {
      if (item.id === 1) throw new Error('network');
      return ok(item.id);
    });
    t.queue.start();
    await t.done;
    expect([...t.have].sort()).toEqual([2, 3]);
    expect(t.statuses.at(-1)).toEqual({ state: 'finished', done: 2 });
    warn.mockRestore();
  });

  it('re-reads the pending list each step, so narrowing filters takes effect', async () => {
    const seen: number[] = [];
    const t = setup(async (item) => {
      seen.push(item.id);
      if (item.id === 1) t.setPool([1, 3]); // user narrowed filters: 2 no longer matches
      return ok(item.id);
    });
    t.queue.start();
    await t.done;
    expect(seen).toEqual([1, 3]);
  });

  it('stop() aborts and reports paused, not blocked', async () => {
    let release!: () => void;
    const t = setup(
      (item) =>
        new Promise((resolve) => {
          release = () => resolve(ok(item.id));
        }),
    );
    t.queue.start();
    await Promise.resolve();
    t.queue.stop('Stopped.');
    release();
    await t.done;
    expect(t.statuses.at(-1)).toEqual({ state: 'paused', reason: 'Stopped.', blocked: false });
    expect(t.have.size).toBe(0);
  });
});
