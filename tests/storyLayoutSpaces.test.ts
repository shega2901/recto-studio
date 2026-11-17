import { describe, expect, it } from 'vitest';
import { layoutStory } from '../src/engine/storyLayout';
import type { ParagraphStyle, StoryContent, TextElement } from '../src/types';

// One millimetre per character keeps every expected position readable.
const measure = (text: string) => text.length;
const frame: TextElement = { id: 'f', type: 'text', pageId: 'p', x: 0, y: 0, width: 10, height: 50,
  text: '', rotation: 0, opacity: 1, zIndex: 1, locked: false, fontFamily: 'serif', fontSizePt: 10,
  lineHeight: 1, letterSpacingPt: 0, color: '#111111', alignment: 'left', columns: 1, columnGutterMm: 2,
  paddingMm: 0, borderWidthMm: 0, borderColor: 'transparent', backgroundColor: 'transparent' };
const style = (alignment: ParagraphStyle['alignment']): ParagraphStyle => ({ id: 'p', name: 'p', fontFamily: 'serif',
  fontSizePt: 10, lineHeight: 1, letterSpacingPt: 0, color: '#111111', alignment, snapToBaseline: false });
const story = (text: string): StoryContent => ({ version: 1, paragraphs: [{ styleId: 'p', runs: [{ text }] }, { styleId: 'p', runs: [{ text: 'end' }] }] });
const compose = (text: string, alignment: ParagraphStyle['alignment'] = 'left', width = 10) =>
  layoutStory(story(text), { ...frame, width }, [style(alignment)], [], measure).lines;
const texts = (lines: ReturnType<typeof compose>) => lines.map(line => line.segments.map(segment => segment.text).join(''));

describe('spaces at line ends', () => {
  it('lets a space that does not fit hang at the end of the line instead of starting the next', () => {
    // "aaaaa bbbb" fills the line exactly; the space after it used to open the next line.
    const lines = compose('aaaaa bbbb cc');
    expect(texts(lines)).toEqual(['aaaaa bbbb ', 'cc', 'end']);
    expect(lines[1].start).toBe(11);
  });

  it('ends a justified line flush with the margin, the space after its last word hanging', () => {
    const [first] = compose('aa bb cccccc', 'justify');
    const words = first.segments.filter(segment => segment.text.trim());
    expect(words.map(segment => [segment.text, segment.x])).toEqual([['aa', 0], ['bb', 8]]);
    expect(words[1].x + words[1].width).toBe(10);
  });

  it('aligns right and centred lines by their text, not by a hanging space', () => {
    expect(compose('aaaaa bbbb cc', 'right', 12)[0].segments[0].x).toBe(2);
    expect(compose('aaaaa bbbb cc', 'center', 12)[0].segments[0].x).toBe(1);
  });
});

describe('non-breaking spaces', () => {
  it('never breaks a line at a non-breaking space', () => {
    // "xx aa bb" with a non-breaking space between aa and bb: the pair moves down together.
    expect(texts(compose('xx aa bb', 'left', 6))).toEqual(['xx ', 'aa bb', 'end']);
    expect(texts(compose('xx aa bb', 'left', 6))).toEqual(['xx ', 'aa bb', 'end']);
  });

  it('still breaks at ordinary spaces around the joined words', () => {
    expect(texts(compose('с огня и волшебный', 'left', 12))).toEqual(['с огня ', 'и волшебный', 'end']);
  });

  it('does not stretch a non-breaking space when justifying', () => {
    const [first] = compose('a b cc dddddddd', 'justify');
    const joined = first.segments.find(segment => segment.text.includes(' '))!;
    expect(joined.text).toBe('a b');
    expect(first.segments.find(segment => segment.text === 'cc')!.x + 2).toBe(10);
  });
});
