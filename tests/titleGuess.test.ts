import { describe, expect, it } from 'vitest';
import { guessFromTitle } from '../src/core/titleGuess';

// Titles from seller 57342735's real listings (RESEARCH.md §3).
describe('guessFromTitle', () => {
  it('reads several colours', () => {
    expect(guessFromTitle('Vintage 90s blue purple funky crazy pattern zipped winter coat jacket unisex Rodeo', 'Rodeo').colors).toEqual([
      'Purple',
      'Blue',
    ]);
    expect(
      guessFromTitle('Abstract brushstroke knit jumper brown burgundy beige crew neck Many men, Many minds 3516').colors.sort(),
    ).toEqual(['Beige', 'Brown', 'Burgundy']);
  });

  it('treats colour block as a pattern, not a colour', () => {
    const g = guessFromTitle('80s 90s retro red green colour block coat jacket Men’s tall 2XL/3XL Angelo Litrico');
    expect(g.patterns).toEqual(['Colour block']);
    expect(g.colors.sort()).toEqual(['Green', 'Red']);
  });

  it('maps synonyms and multi-word colours to one label', () => {
    expect(guessFromTitle('Cobalt blue parka jacket').colors).toEqual(['Blue']);
    expect(guessFromTitle('Light blue denim shirt').colors).toEqual(['Light blue']);
    expect(guessFromTitle('Olive red botanical striped wool long skirt').colors.sort()).toEqual(['Khaki', 'Red']);
  });

  it('reads materials and patterns', () => {
    const g = guessFromTitle('Olive red botanical striped wool long skirt pleated lined UK 10(M) Edith Moser 3499');
    expect(g.materials).toEqual(['Wool']);
    expect(g.patterns).toEqual(['Striped']);
    expect(guessFromTitle('Pure wool geometric jumper moss green').patterns).toEqual(['Geometric']);
    expect(guessFromTitle('Cottagecore plaid long skirt blue white').patterns).toEqual(['Checked']);
    expect(guessFromTitle('Faux leather biker jacket').materials).toEqual(['Faux leather']);
  });

  it('matches whole words only', () => {
    expect(guessFromTitle('Redwood hoodie').colors).toEqual([]);
    expect(guessFromTitle('Shredded jeans').colors).toEqual([]);
    expect(guessFromTitle('Classic tan bag, unchecked').patterns).toEqual([]);
  });

  it('ignores colours that are part of the brand', () => {
    expect(guessFromTitle('Red Herring floral dress', 'Red Herring').colors).toEqual([]);
    expect(guessFromTitle('White Stuff navy jumper', 'White Stuff').colors).toEqual(['Navy']);
  });

  it('copes with punctuation, case and accents', () => {
    expect(guessFromTitle('BLACK/WHITE striped tee').colors.sort()).toEqual(['Black', 'White']);
    expect(guessFromTitle('Écru linen trousers').colors).toEqual(['Cream']);
  });
});
