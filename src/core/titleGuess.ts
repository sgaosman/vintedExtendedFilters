import type { Item } from '../vinted/types';

// Approximate colour, material and pattern read from listing titles, used until
// an item's page has been fetched (RESEARCH.md D11). Labels follow Vinted UK's
// filter names where known, so guesses and real values usually share an option.
// English only: other country sites get no guesses, just the normal fetch.

export interface TitleGuess {
  colors: string[];
  materials: string[];
  patterns: string[];
}

type Vocab = Array<[phrase: string, label: string]>;

const COLORS: Vocab = [
  // Multi-word phrases first, so "light blue" doesn't also count as "blue".
  ['light blue', 'Light blue'], ['sky blue', 'Light blue'], ['baby blue', 'Light blue'], ['pale blue', 'Light blue'],
  ['navy blue', 'Navy'], ['royal blue', 'Blue'], ['cobalt blue', 'Blue'],
  ['dark green', 'Dark green'], ['forest green', 'Dark green'], ['bottle green', 'Dark green'],
  ['off white', 'Cream'], ['multi coloured', 'Multi'], ['multi colored', 'Multi'],
  ['black', 'Black'],
  ['grey', 'Grey'], ['gray', 'Grey'], ['charcoal', 'Grey'],
  ['white', 'White'],
  ['cream', 'Cream'], ['ivory', 'Cream'], ['ecru', 'Cream'],
  ['beige', 'Beige'], ['camel', 'Beige'], ['taupe', 'Beige'], ['oatmeal', 'Beige'],
  ['apricot', 'Apricot'], ['peach', 'Apricot'],
  ['orange', 'Orange'], ['rust', 'Orange'],
  ['coral', 'Coral'],
  ['red', 'Red'], ['scarlet', 'Red'], ['crimson', 'Red'],
  ['burgundy', 'Burgundy'], ['maroon', 'Burgundy'], ['oxblood', 'Burgundy'], ['claret', 'Burgundy'],
  ['pink', 'Pink'], ['fuchsia', 'Pink'], ['magenta', 'Pink'],
  ['purple', 'Purple'], ['violet', 'Purple'], ['plum', 'Purple'], ['aubergine', 'Purple'], ['mauve', 'Purple'],
  ['lilac', 'Lilac'], ['lavender', 'Lilac'],
  ['blue', 'Blue'], ['cobalt', 'Blue'],
  ['navy', 'Navy'],
  ['turquoise', 'Turquoise'], ['teal', 'Turquoise'], ['aqua', 'Turquoise'],
  ['mint', 'Mint'],
  ['green', 'Green'], ['emerald', 'Green'], ['lime', 'Green'],
  ['khaki', 'Khaki'], ['olive', 'Khaki'],
  ['brown', 'Brown'], ['chocolate', 'Brown'], ['mocha', 'Brown'], ['chestnut', 'Brown'],
  ['mustard', 'Mustard'], ['ochre', 'Mustard'],
  ['yellow', 'Yellow'], ['lemon', 'Yellow'],
  ['silver', 'Silver'],
  ['gold', 'Gold'], ['golden', 'Gold'],
  ['multicolour', 'Multi'], ['multicolor', 'Multi'], ['multicoloured', 'Multi'], ['rainbow', 'Multi'],
];

const MATERIALS: Vocab = [
  ['faux leather', 'Faux leather'], ['vegan leather', 'Faux leather'], ['pu leather', 'Faux leather'],
  ['faux fur', 'Faux fur'],
  ['cotton', 'Cotton'],
  ['wool', 'Wool'], ['woollen', 'Wool'], ['woolen', 'Wool'], ['lambswool', 'Wool'], ['merino', 'Wool'],
  ['cashmere', 'Cashmere'],
  ['mohair', 'Mohair'],
  ['alpaca', 'Alpaca'],
  ['angora', 'Angora'],
  ['polyester', 'Polyester'],
  ['nylon', 'Nylon'],
  ['acrylic', 'Acrylic'],
  ['viscose', 'Viscose'], ['rayon', 'Viscose'],
  ['silk', 'Silk'],
  ['satin', 'Satin'],
  ['linen', 'Linen'],
  ['leather', 'Leather'],
  ['suede', 'Suede'],
  ['denim', 'Denim'],
  ['corduroy', 'Corduroy'], ['cords', 'Corduroy'],
  ['velvet', 'Velvet'], ['velour', 'Velvet'],
  ['fleece', 'Fleece'],
  ['tweed', 'Tweed'],
  ['lace', 'Lace'],
  ['elastane', 'Elastane'], ['spandex', 'Elastane'], ['lycra', 'Elastane'],
];

const PATTERNS: Vocab = [
  ['colour block', 'Colour block'], ['color block', 'Colour block'], ['colourblock', 'Colour block'],
  ['animal print', 'Animal print'], ['leopard', 'Animal print'], ['zebra', 'Animal print'], ['cheetah', 'Animal print'],
  ['snakeskin', 'Animal print'],
  ['polka dot', 'Polka dot'], ['polka dots', 'Polka dot'], ['spotty', 'Polka dot'],
  ['tie dye', 'Tie-dye'], ['tie dyed', 'Tie-dye'],
  ['stripe', 'Striped'], ['stripes', 'Striped'], ['striped', 'Striped'], ['pinstripe', 'Striped'],
  ['check', 'Checked'], ['checked', 'Checked'], ['checkered', 'Checked'], ['plaid', 'Checked'], ['tartan', 'Checked'],
  ['gingham', 'Checked'], ['houndstooth', 'Checked'],
  ['floral', 'Floral'], ['flower', 'Floral'], ['flowers', 'Floral'],
  ['camo', 'Camouflage'], ['camouflage', 'Camouflage'],
  ['paisley', 'Paisley'],
  ['geometric', 'Geometric'],
  ['abstract', 'Abstract'],
];

/** Lowercase, accent-free, letters and digits only, single-spaced, padded for whole-word matching. */
function normalise(s: string): string {
  const flat = s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return ` ${flat} `;
}

function match(text: string, vocab: Vocab): { labels: string[]; rest: string } {
  const labels: string[] = [];
  let rest = text;
  for (const [phrase, label] of vocab) {
    const needle = ` ${phrase} `;
    if (!rest.includes(needle)) continue;
    if (!labels.includes(label)) labels.push(label);
    // Blank the phrase so shorter phrases inside it ("blue" in "light blue") don't match again.
    rest = rest.split(needle).join('  ');
  }
  return { labels, rest };
}

/**
 * Guesses attributes from the title. The brand is removed first, so brands like
 * "Red Herring" or "White Stuff" don't count as colours.
 */
export function guessFromTitle(title: string, brand = ''): TitleGuess {
  let text = normalise(title);
  const brandText = normalise(brand).trim();
  if (brandText) text = text.split(` ${brandText} `).join('  ');
  const patterns = match(text, PATTERNS);
  // "Colour block" etc. are patterns, not colours, so colours are read after removing them.
  const colors = match(patterns.rest, COLORS);
  const materials = match(text, MATERIALS);
  return { colors: colors.labels, materials: materials.labels, patterns: patterns.labels };
}

export function guessForItem(item: Pick<Item, 'title' | 'brand'>): TitleGuess {
  return guessFromTitle(item.title, item.brand);
}
