import { describe, it, expect, beforeEach } from 'vitest';
import { stateManager } from '../src/state/stateManager';
import { TextElement, Paragraph } from '../src/types/index';
import {
  getPlainText,
  setPlainText,
  ensureParagraphs,
  reconcileParagraphs,
  resolveParagraphStyleId,
  paragraphIndicesForRange,
} from '../src/utils/paragraphs';

function makeText(text: string, extra: Partial<TextElement> = {}): TextElement {
  return {
    id: 'model-sample',
    type: 'text',
    pageId: stateManager.getActiveSpread().pages[0].id,
    x: 10,
    y: 10,
    width: 90,
    height: 60,
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    locked: false,
    text,
    fontFamily: 'Inter, sans-serif',
    fontSizePt: 10,
    lineHeight: 1.4,
    letterSpacingPt: 0,
    color: '#111111',
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

function styles(paragraphs: Paragraph[]) {
  return paragraphs.map(p => p.styleId);
}

describe('Paragraph model helpers', () => {
  it('migrates legacy text into one paragraph per line', () => {
    const el = makeText('One\nTwo\n\nFour');
    ensureParagraphs(el);
    expect(el.paragraphs!.map(p => p.text)).toEqual(['One', 'Two', '', 'Four']);
    expect(getPlainText(el)).toBe('One\nTwo\n\nFour');
  });

  it('treats empty text as a single empty paragraph', () => {
    const el = makeText('');
    ensureParagraphs(el);
    expect(el.paragraphs).toEqual([{ text: '' }]);
  });

  it('does not touch a legacy frame-level style (paragraphs inherit it)', () => {
    const el = makeText('A\nB', { paragraphStyleId: 'style-body' });
    ensureParagraphs(el);
    expect(styles(el.paragraphs!)).toEqual([undefined, undefined]);
    expect(el.paragraphs!.map(p => resolveParagraphStyleId(el, p))).toEqual(['style-body', 'style-body']);
  });

  it('keeps paragraph styles when text inside a paragraph is edited', () => {
    const el = makeText('Title\nBody');
    ensureParagraphs(el);
    el.paragraphs![0].styleId = 'style-h1';
    el.paragraphs![1].styleId = 'style-body';

    setPlainText(el, 'Title edited\nBody');

    expect(el.text).toBe('Title edited\nBody');
    expect(styles(el.paragraphs!)).toEqual(['style-h1', 'style-body']);
  });

  it('keeps styles aligned when a whole paragraph is inserted in the middle', () => {
    const old: Paragraph[] = [
      { text: 'A', styleId: 'style-h1' },
      { text: 'C', styleId: 'style-body' },
    ];
    const next = reconcileParagraphs(old, 'A\nB\nC');
    expect(next.map(p => p.text)).toEqual(['A', 'B', 'C']);
    // New paragraph inherits from the one before it; C keeps its own style.
    expect(styles(next)).toEqual(['style-h1', 'style-h1', 'style-body']);
  });

  it('new paragraph created by Enter inherits the style of the split paragraph', () => {
    const old: Paragraph[] = [
      { text: 'ABCD', styleId: 'style-h2' },
      { text: 'Tail', styleId: 'style-body' },
    ];
    const next = reconcileParagraphs(old, 'AB\nCD\nTail');
    expect(next.map(p => p.text)).toEqual(['AB', 'CD', 'Tail']);
    expect(styles(next)).toEqual(['style-h2', 'style-h2', 'style-body']);
  });

  it('keeps the remaining styles when a paragraph is deleted', () => {
    const old: Paragraph[] = [
      { text: 'A', styleId: 'style-h1' },
      { text: 'B', styleId: 'style-h2' },
      { text: 'C', styleId: 'style-body' },
    ];
    const next = reconcileParagraphs(old, 'A\nC');
    expect(next.map(p => p.text)).toEqual(['A', 'C']);
    expect(styles(next)).toEqual(['style-h1', 'style-body']);
  });

  it('merged paragraphs (Backspace at start) keep the first paragraph style', () => {
    const old: Paragraph[] = [
      { text: 'AB', styleId: 'style-h1' },
      { text: 'CD', styleId: 'style-body' },
    ];
    const next = reconcileParagraphs(old, 'ABCD');
    expect(next).toEqual([{ text: 'ABCD', styleId: 'style-h1' }]);
  });

  it('copies overrides instead of sharing the object between paragraphs', () => {
    const old: Paragraph[] = [{ text: 'AB', styleId: 'style-body', overrides: { fontSizePt: 14 } }];
    const next = reconcileParagraphs(old, 'A\nB');
    next[0].overrides!.fontSizePt = 99;
    expect(next[1].overrides!.fontSizePt).toBe(14);
    expect(old[0].overrides!.fontSizePt).toBe(14);
  });
});

describe('Paragraph model inside stateManager', () => {
  beforeEach(() => {
    stateManager.resetToDefault();
  });

  function getEl(id: string): TextElement {
    return stateManager.getActiveSpread().elements.find(e => e.id === id) as TextElement;
  }

  it('gives every text frame of the default document a paragraphs list', () => {
    const texts = stateManager.getState().spreads.flatMap(s => s.elements).filter(e => e.type === 'text') as TextElement[];
    expect(texts.length).toBeGreaterThan(0);
    for (const el of texts) {
      expect(el.paragraphs, el.id).toBeDefined();
      expect(getPlainText(el), el.id).toBe(el.text);
    }
  });

  it('adds paragraphs when a text frame is added', () => {
    stateManager.addElement(makeText('X\nY'));
    expect(getEl('model-sample').paragraphs!.map(p => p.text)).toEqual(['X', 'Y']);
  });

  it('legacy writers that only set `text` keep paragraph styles via updateElement', () => {
    stateManager.addElement(makeText('Title\nBody'));
    stateManager.updateElement('model-sample', {
      paragraphs: [
        { text: 'Title', styleId: 'style-h1' },
        { text: 'Body', styleId: 'style-body' },
      ],
    });

    stateManager.updateElement('model-sample', { text: 'Title\nBody\nMore body' });

    const el = getEl('model-sample');
    expect(el.paragraphs!.map(p => p.text)).toEqual(['Title', 'Body', 'More body']);
    expect(styles(el.paragraphs!)).toEqual(['style-h1', 'style-body', 'style-body']);
  });

  it('rebuilds `text` when new code updates only `paragraphs`', () => {
    stateManager.addElement(makeText('Old'));
    stateManager.updateElement('model-sample', { paragraphs: [{ text: 'New one' }, { text: 'New two' }] });
    expect(getEl('model-sample').text).toBe('New one\nNew two');
  });

  it('migrates an old saved project (no paragraphs) when it is loaded from JSON', () => {
    stateManager.addElement(makeText('Legacy A\nLegacy B', { paragraphStyleId: 'style-body' }));
    const legacy = JSON.parse(JSON.stringify(stateManager.getState()));
    for (const spread of legacy.spreads) {
      for (const el of spread.elements) delete el.paragraphs;
    }

    stateManager.loadFromJson(JSON.stringify(legacy));

    const el = getEl('model-sample');
    expect(el.paragraphs!.map(p => p.text)).toEqual(['Legacy A', 'Legacy B']);
    expect(el.paragraphStyleId).toBe('style-body');
    expect(styles(el.paragraphs!)).toEqual([undefined, undefined]);
  });

  it('survives undo/redo with paragraph data intact', () => {
    stateManager.addElement(makeText('One\nTwo'));
    stateManager.updateElement('model-sample', {
      paragraphs: [{ text: 'One', styleId: 'style-h1' }, { text: 'Two' }],
    });
    stateManager.undo();
    expect(styles(getEl('model-sample').paragraphs!)).toEqual([undefined, undefined]);
    stateManager.redo();
    expect(styles(getEl('model-sample').paragraphs!)).toEqual(['style-h1', undefined]);
  });
});

describe('paragraphIndicesForRange (caret / selection -> paragraphs)', () => {
  const text = 'First\nSecond\n\nFourth'; // paragraphs at 0-5, 6-12, 13, 14-20
  const at = (start: number, end: number = start) => paragraphIndicesForRange(text, start, end);

  it('maps a caret to exactly one paragraph, including both ends of a line', () => {
    expect(at(0)).toEqual([0]);
    expect(at(5)).toEqual([0]); // end of "First", before its newline
    expect(at(6)).toEqual([1]); // start of "Second"
    expect(at(9)).toEqual([1]);
    expect(at(13)).toEqual([2]); // the empty paragraph
    expect(at(text.length)).toEqual([3]); // end of text
  });

  it('covers every paragraph a selection contains a character of', () => {
    expect(at(2, 9)).toEqual([0, 1]);
    expect(at(0, text.length)).toEqual([0, 1, 2, 3]);
    expect(at(8, 8 + 1)).toEqual([1]);
  });

  it('does not reach into the next paragraph when a selection ends where it begins', () => {
    expect(at(0, 6)).toEqual([0]); // "First" plus its newline
    expect(at(6, 13)).toEqual([1]); // "Second" plus its newline
  });

  it('counts a selected paragraph mark as part of its paragraph', () => {
    expect(at(5, 7)).toEqual([0, 1]); // newline of "First" + first char of "Second"
  });

  it('accepts a reversed (backwards) selection', () => {
    expect(at(9, 2)).toEqual([0, 1]);
  });

  it('returns null when the positions are unavailable', () => {
    expect(paragraphIndicesForRange(text, null, null)).toBeNull();
  });
});
