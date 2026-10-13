import { describe, expect, it, vi } from 'vitest';
import { Panel } from '../src/ui/panel';
import { SellerSession, type SessionDeps } from '../src/core/sellerSession';
import type { Item, ItemDetails } from '../src/vinted/types';

const mk = (id: number, brand: string, price: number): Item => ({
  id,
  title: `<img src=x onerror=alert(1)> item ${id}`,
  url: `https://www.vinted.co.uk/items/${id}`,
  price,
  totalPrice: price + 1,
  currency: 'GBP',
  brand,
  size: 'M',
  condition: 'Very good',
  thumb: '',
  favourites: 0,
  reserved: false,
  rank: id,
});

function session(): SellerSession {
  const items = [mk(1, 'Rodeo', 20), mk(2, 'Vintage Dressing', 27.5), mk(3, 'Vintage Dressing', 22)];
  const deps: Partial<SessionDeps> = {
    loadWardrobe: vi.fn(async (q: { catalogIds: string }) => (q.catalogIds === '2533' ? [items[0]!] : items)),
    loadCategoryTree: vi.fn(async () => [{ id: 2533, title: 'Overcoats & long coats', count: 1, children: [] }]),
    fetchItemDetails: vi.fn(async (item: Item) => ({
      kind: 'ok' as const,
      details: { id: item.id, colors: [item.id === 1 ? 'Blue' : 'Red'], materials: [], patterns: [], attributes: {}, fetchedAt: 0 } as ItemDetails,
    })),
    getCategory: vi.fn(async () => undefined),
    putCategory: vi.fn(async () => {}),
    getWardrobe: vi.fn(async () => undefined),
    putWardrobe: vi.fn(async () => {}),
    getDetails: vi.fn(async () => new Map()),
    putDetails: vi.fn(async () => {}),
    sleep: vi.fn().mockResolvedValue(undefined),
    detailDelayMs: 1,
  };
  return new SellerSession(57342735, deps);
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

function setup() {
  const panel = new Panel();
  document.body.append(panel.host);
  const s = session();
  panel.setSession(s);
  panel.onRequestLoad = (force) => void s.loadItems(force);
  const root = panel.host.shadowRoot!;
  const cards = () => root.querySelectorAll('ul.grid > li');
  return { panel, s, root, cards };
}

describe('Panel', () => {
  it('stays hidden until a member page shows the launcher, then loads on open', async () => {
    const { panel, s, root, cards } = setup();
    const launcher = root.querySelector('.launcher') as HTMLButtonElement;
    expect(launcher.hidden).toBe(true);
    panel.setLauncherVisible(true);
    expect(launcher.hidden).toBe(false);

    launcher.click();
    expect(panel.isOpen).toBe(true);
    await flush();
    panel.render();
    expect(s.load.kind).toBe('ready');
    expect(cards()).toHaveLength(3);
    expect(root.querySelector('[role="status"]')?.textContent).toContain('3 items');
  });

  it('renders seller text as text, never markup', async () => {
    const { panel, root } = setup();
    panel.open();
    await flush();
    panel.render();
    expect(root.querySelector('ul.grid img')).toBeNull();
    expect(root.querySelector('.card .title')?.textContent).toContain('<img');
  });

  it('filters by brand checkbox and shows a removable chip', async () => {
    const { panel, root, cards } = setup();
    panel.open();
    await flush();
    panel.render();

    const brandBox = Array.from(root.querySelectorAll<HTMLInputElement>('.options input[type="checkbox"]')).find(
      (cb) => cb.closest('label')?.textContent?.startsWith('Rodeo'),
    )!;
    brandBox.checked = true;
    brandBox.dispatchEvent(new Event('change'));
    panel.render();
    expect(cards()).toHaveLength(1);

    const chip = root.querySelector('.chip') as HTMLButtonElement;
    expect(chip.textContent).toContain('Brand: Rodeo');
    chip.click();
    panel.render();
    expect(cards()).toHaveLength(3);
  });

  it('applies the price range', async () => {
    const { panel, root, cards } = setup();
    panel.open();
    await flush();
    const [min, max] = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="number"]'));
    min!.value = '21';
    max!.value = '25';
    max!.dispatchEvent(new Event('change'));
    panel.render();
    expect(cards()).toHaveLength(1);
    expect(root.querySelector('.card .price')?.textContent).toContain('22');
  });

  it('loads details on request and filters by colour', async () => {
    const { panel, s, root, cards } = setup();
    panel.open();
    await flush();
    panel.render();
    const start = root.querySelector('.details-box .btn.primary') as HTMLButtonElement;
    expect(start.textContent).toBe('Load details for 3 items');
    start.click();
    await flush();
    expect(s.queueStatus.state).toBe('finished');
    panel.render();

    const blue = Array.from(root.querySelectorAll<HTMLInputElement>('.options input[type="checkbox"]')).find(
      (cb) => cb.closest('label')?.textContent?.startsWith('Blue'),
    )!;
    blue.checked = true;
    blue.dispatchEvent(new Event('change'));
    panel.render();
    expect(cards()).toHaveLength(1);
  });

  it("shows Vinted's category tree and filters by it", async () => {
    const { panel, root, cards } = setup();
    panel.open();
    await flush();
    panel.render();
    const cat = root.querySelector<HTMLInputElement>('[data-focus-key="cat-2533"]')!;
    expect(cat.closest('label')?.textContent).toContain('Overcoats & long coats');
    cat.checked = true;
    cat.dispatchEvent(new Event('change'));
    await flush();
    panel.render();
    expect(cards()).toHaveLength(1);
    expect(root.querySelector('.chip')?.textContent).toContain('Overcoats & long coats');
  });

  it('marks title-only matches and lets them be turned off', async () => {
    const { panel, root, cards } = setup();
    panel.open();
    await flush();
    panel.render();
    // No details loaded yet; filter by a colour that only titles mention.
    panel['session']!.updateFilters((f) => f.selected.color.add('Blue'));
    panel.render();
    expect(cards()).toHaveLength(0); // the fixture titles mention no colours

    panel['session']!.items[0]!.title = 'Blue denim jacket';
    panel['session']!['guessCache'].clear();
    panel.render();
    expect(cards()).toHaveLength(1);
    expect(root.querySelector('.badge.approx')?.textContent).toBe('From title');
    expect(root.querySelector('[aria-live="polite"]')?.textContent).toContain('1 matched from titles');

    const toggle = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find((cb) =>
      cb.closest('label')?.textContent?.startsWith('Use titles'),
    )!;
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    panel.render();
    expect(cards()).toHaveLength(0);
  });

  it('keeps fetching details with the panel closed and shows progress on the launcher', async () => {
    const { panel, s, root } = setup();
    panel.setLauncherVisible(true);
    panel.open();
    await flush();
    panel.render();
    // Hold the second fetch so the run is still going when we look.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const original = s['deps'].fetchItemDetails;
    s['deps'].fetchItemDetails = async (item, signal) => {
      if (item.id !== 1) await gate;
      return original(item, signal);
    };
    s['queue']['deps'].fetchDetails = s['deps'].fetchItemDetails;
    s.startDetails();
    panel.close();
    await flush();
    panel.render();
    expect(s.detailsRunning).toBe(true);
    expect(root.querySelector('.launcher')?.textContent).toMatch(/details: \d+ left/);
    release();
    await flush();
    expect(s.queueStatus.state).toBe('finished');
  });

  it('closes on Escape', async () => {
    const { panel, root } = setup();
    panel.open();
    root.querySelector('.overlay')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.isOpen).toBe(false);
  });
});
