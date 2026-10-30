import { describe, it, expect, beforeEach } from 'vitest';
import { stateManager, DEFAULT_PARAGRAPH_STYLES } from '../src/state/stateManager';
import { TextElement, Paragraph, ParagraphStyle } from '../src/types/index';
import {
  frameParagraphFormat,
  resolveParagraphFormat,
  hasParagraphVariation,
  getParagraphsForRender,
  paragraphFormatsKey,
} from '../src/utils/paragraphFormat';

function frame(extra: Partial<TextElement> = {}): TextElement {
  return {
    id: 'fmt-sample',
    type: 'text',
    pageId: 'p',
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    locked: false,
    text: 'A\nB\nC',
    fontFamily: 'Inter, sans-serif',
    fontSizePt: 10,
    lineHeight: 1.4,
    letterSpacingPt: 0,
    color: '#222222',
    alignment: 'left',
    columns: 1,
    columnGutterMm: 4,
    borderColor: 'transparent',
    borderWidthMm: 0,
    backgroundColor: 'transparent',
    paddingMm: 2,
    ...extra,
  };
}

const H1 = DEFAULT_PARAGRAPH_STYLES.find(s => s.id === 'style-h1')!;
const styles = DEFAULT_PARAGRAPH_STYLES;

describe('resolveParagraphFormat', () => {
  it('uses the frame fields when a paragraph has no style or overrides', () => {
    const el = frame();
    const f = resolveParagraphFormat(el, { text: 'A' }, styles);
    expect(f).toEqual(frameParagraphFormat(el));
    expect(f.fontSizePt).toBe(10);
    expect(f.color).toBe('#222222');
  });

  it('replaces the frame fields with the paragraph style', () => {
    const el = frame({ dropCapLines: 3, alignment: 'justify' });
    const f = resolveParagraphFormat(el, { text: 'A', styleId: 'style-h1' }, styles);
    expect(f.fontFamily).toBe(H1.fontFamily);
    expect(f.fontSizePt).toBe(H1.fontSizePt);
    expect(f.lineHeight).toBe(H1.lineHeight);
    expect(f.alignment).toBe(H1.alignment);
    // The style defines the paragraph completely: the frame's drop cap does not leak in.
    expect(f.dropCapLines).toBe(0);
  });

  it('lets local overrides win over the style', () => {
    const f = resolveParagraphFormat(
      frame(),
      { text: 'A', styleId: 'style-h1', overrides: { fontSizePt: 40, color: '#ff0000' } },
      styles,
    );
    expect(f.fontSizePt).toBe(40);
    expect(f.color).toBe('#ff0000');
    expect(f.fontFamily).toBe(H1.fontFamily);
  });

  it('applies overrides on top of the frame when there is no style', () => {
    const f = resolveParagraphFormat(frame(), { text: 'A', overrides: { alignment: 'center' } }, styles);
    expect(f.alignment).toBe('center');
    expect(f.fontSizePt).toBe(10);
  });

  it('falls back to the frame format when the style no longer exists', () => {
    const f = resolveParagraphFormat(frame(), { text: 'A', styleId: 'style-deleted' }, styles);
    expect(f).toEqual(frameParagraphFormat(frame()));
  });
});

describe('hasParagraphVariation', () => {
  it('is false for plain paragraphs and missing lists', () => {
    expect(hasParagraphVariation(undefined)).toBe(false);
    expect(hasParagraphVariation([{ text: 'A' }, { text: 'B' }])).toBe(false);
    expect(hasParagraphVariation([{ text: 'A', overrides: {} }])).toBe(false);
  });

  it('is true when any paragraph has a style or overrides', () => {
    expect(hasParagraphVariation([{ text: 'A' }, { text: 'B', styleId: 'style-h1' }])).toBe(true);
    expect(hasParagraphVariation([{ text: 'A', overrides: { fontSizePt: 12 } }])).toBe(true);
  });
});

describe('getParagraphsForRender', () => {
  it('returns the stored paragraphs when they match the text', () => {
    const paragraphs: Paragraph[] = [{ text: 'A', styleId: 'style-h1' }, { text: 'B' }];
    expect(getParagraphsForRender({ text: 'A\nB', paragraphs })).toBe(paragraphs);
  });

  it('rebuilds a matching list, keeping styles, when legacy code changed only the text', () => {
    const paragraphs: Paragraph[] = [{ text: 'A', styleId: 'style-h1' }, { text: 'B' }];
    const result = getParagraphsForRender({ text: 'A\nB\nC', paragraphs })!;
    expect(result.map(p => p.text)).toEqual(['A', 'B', 'C']);
    expect(result[0].styleId).toBe('style-h1');
    // The element itself is not mutated while rendering.
    expect(paragraphs).toHaveLength(2);
  });

  it('returns undefined for elements that were never migrated', () => {
    expect(getParagraphsForRender({ text: 'A', paragraphs: undefined })).toBeUndefined();
  });
});

describe('paragraphFormatsKey (layout cache key)', () => {
  const key = (el: TextElement, ps: ParagraphStyle[] = styles) =>
    paragraphFormatsKey((el.paragraphs ?? []).map(p => resolveParagraphFormat(el, p, ps)));

  it('changes when a different style is applied to one paragraph', () => {
    const a = frame({ paragraphs: [{ text: 'A' }, { text: 'B' }, { text: 'C' }] });
    const b = frame({ paragraphs: [{ text: 'A' }, { text: 'B', styleId: 'style-h1' }, { text: 'C' }] });
    expect(key(a)).not.toBe(key(b));
  });

  it('changes when the paragraph that carries the style changes', () => {
    const a = frame({ paragraphs: [{ text: 'A', styleId: 'style-h1' }, { text: 'B' }] });
    const b = frame({ paragraphs: [{ text: 'A' }, { text: 'B', styleId: 'style-h1' }] });
    expect(key(a)).not.toBe(key(b));
  });

  it('changes when the definition of an applied style is edited', () => {
    const el = frame({ paragraphs: [{ text: 'A', styleId: 'style-h1' }, { text: 'B' }] });
    const edited = styles.map(s => (s.id === 'style-h1' ? { ...s, fontSizePt: s.fontSizePt + 6 } : s));
    expect(key(el, styles)).not.toBe(key(el, edited));
  });

  it('changes when only a local override changes', () => {
    const a = frame({ paragraphs: [{ text: 'A', overrides: { fontSizePt: 12 } }] });
    const b = frame({ paragraphs: [{ text: 'A', overrides: { fontSizePt: 14 } }] });
    expect(key(a)).not.toBe(key(b));
  });

  it('is stable for identical formats', () => {
    const a = frame({ paragraphs: [{ text: 'A', styleId: 'style-h1' }, { text: 'B' }] });
    const b = frame({ paragraphs: [{ text: 'A', styleId: 'style-h1' }, { text: 'B' }] });
    expect(key(a)).toBe(key(b));
  });
});

describe('deleting a paragraph style', () => {
  beforeEach(() => {
    stateManager.resetToDefault();
  });

  it('detaches paragraphs that used it', () => {
    stateManager.addElement(frame({ id: 'del-sample', pageId: stateManager.getActiveSpread().pages[0].id, text: 'A\nB' }));
    stateManager.applyParagraphStyle('del-sample', 'style-h2', [0]);

    stateManager.deleteParagraphStyle('style-h2');

    const el = stateManager.getActiveSpread().elements.find(e => e.id === 'del-sample') as TextElement;
    expect(el.paragraphs!.every(p => p.styleId === undefined)).toBe(true);
  });
});
