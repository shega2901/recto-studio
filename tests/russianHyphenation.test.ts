import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseTexPatterns } from '../src/engine/hyphenation/texPatterns';
import { hyphenateLanguage, hyphenationGeneration, loadHyphenation, onHyphenationLoaded } from '../src/engine/languageHyphenation';
import { documentHyphenationLanguages, storyHeadsHyphenatedIn } from '../src/engine/documentLanguages';
import { layoutStory } from '../src/engine/storyLayout';
import { plainStory, storyText } from '../src/engine/storyContent';
import type { ParagraphStyle, ProjectState, TextElement } from '../src/types';

const measure = (text: string, style: { fontSizePt: number }) => Array.from(text).length * style.fontSizePt * 0.5 * 25.4 / 72;
const frame = { id: 'f', type: 'text', x: 0, y: 0, width: 18, height: 60, rotation: 0, opacity: 1, zIndex: 1, text: '',
  fontFamily: 'serif', fontSizePt: 10, lineHeight: 1.2, letterSpacingPt: 0, color: '#000', alignment: 'left', columns: 1,
  columnGutterMm: 4, paddingMm: 0, borderColor: 'transparent', borderWidthMm: 0, backgroundColor: 'transparent' } as unknown as TextElement;
const russian: ParagraphStyle = { id: 'ru-body', name: 'Текст', fontFamily: 'serif', fontSizePt: 10, lineHeight: 1.2,
  letterSpacingPt: 0, color: '#000', alignment: 'left', snapToBaseline: false, hyphenate: true, language: 'ru' };

describe('TeX hyphenation patterns', () => {
  it('reads patterns and exceptions, skipping comments', () => {
    const language = parseTexPatterns(`% title: test
\\patterns{ % comment
.аб1р 1ба
б1в
}
\\hyphenation{
биз-нес-мен
}`, { id: 'xx', leftmin: 2, rightmin: 2 });
    expect(language).toEqual({ id: 'xx', leftmin: 2, rightmin: 2,
      patterns: { 5: '_аб1р', 3: '1баб1в' }, exceptions: 'биз‧нес‧мен' });
    expect(() => parseTexPatterns('% nothing here', { id: 'xx', leftmin: 2, rightmin: 2 })).toThrow('No hyphenation patterns');
  });

  it('ships the same unmodified Russian file the licence notice publishes', async () => {
    const [bundled, published] = await Promise.all(['../src/engine/hyphenation/hyph-ru.tex', '../public/licenses/hyphenation/hyph-ru.tex']
      .map(path => readFile(new URL(path, import.meta.url))));
    expect(bundled.equals(published)).toBe(true);
    expect(published.toString('utf8')).toContain('Copyright (C) 1999-2003 Alexander I. Lebedev');
  });

  it('reads the whole Russian file that ships with the editor', async () => {
    const ru = (await import('../src/engine/hyphenation/ru')).default;
    expect(ru).toMatchObject({ id: 'ru', leftmin: 2, rightmin: 2 });
    const count = Object.entries(ru.patterns).reduce((n, [length, group]) => n + group.length / Number(length), 0);
    expect(count).toBeGreaterThan(7000);
    expect(ru.exceptions).toContain('биз‧нес‧мен');
  });
});

describe('Russian hyphenation', () => {
  it('loads on demand and tells listeners, then hyphenates by the Russian rules', async () => {
    const before = hyphenationGeneration();
    const heard: string[] = [];
    const stop = onHyphenationLoaded(language => heard.push(language));
    // Not loaded yet: the word stays whole while the dictionary is fetched.
    expect(hyphenateLanguage('переносы', 'ru')).toEqual(['переносы']);
    expect(await loadHyphenation('ru')).toBe(true);
    stop();
    expect(heard).toEqual(['ru']);
    expect(hyphenationGeneration()).toBe(before + 1);
    // A second load is the same one.
    expect(await loadHyphenation('ru')).toBe(true);
    expect(hyphenationGeneration()).toBe(before + 1);

    expect(hyphenateLanguage('переносы', 'ru')).toEqual(['пе', 'ре', 'но', 'сы']);
    expect(hyphenateLanguage('издательство', 'ru')).toEqual(['из', 'да', 'тель', 'ство']);
    expect(hyphenateLanguage('подъезд', 'ru')).toEqual(['подъ', 'езд']);
    // From the file's exception list.
    expect(hyphenateLanguage('бизнесмен', 'ru')).toEqual(['биз', 'нес', 'мен']);
    expect(await loadHyphenation('xx')).toBe(false);
  });

  it('breaks a Russian paragraph with a hyphen and keeps every character', async () => {
    await loadHyphenation('ru');
    const text = 'Типографика издательства';
    const content = plainStory(text, russian.id);
    const result = layoutStory(content, frame, [russian], [], measure);
    const lines = result.lines.map(line => line.segments.map(segment => segment.text).join(''));
    expect(lines.some(line => line.endsWith('-'))).toBe(true);
    expect(lines.join('').replace(/-/g, '').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
    expect(storyText(content)).toBe(text);
  });

  it('finds the languages a document hyphenates and the stories a dictionary changes', () => {
    const story = (id: string, styleId: string, language?: string) => ({ ...frame, id,
      storyContent: { version: 1, paragraphs: [{ styleId, ...(language ? { language } : {}), runs: [{ text: 'Текст' }] }] } });
    const plain: ParagraphStyle = { ...russian, id: 'plain', language: 'en-US', hyphenate: false };
    const state = { paragraphStyles: [russian, plain], spreads: [{ elements: [
      story('a', russian.id), story('b', plain.id), story('c', plain.id, 'de'),
    ] }] } as unknown as ProjectState;
    expect([...documentHyphenationLanguages(state)]).toEqual(['ru']);
    expect(storyHeadsHyphenatedIn(state, 'ru').map(head => head.id)).toEqual(['a']);
    expect(storyHeadsHyphenatedIn(state, 'de')).toEqual([]);
  });
});
