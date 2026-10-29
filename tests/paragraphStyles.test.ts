import { describe, it, expect, beforeEach } from 'vitest';
import { stateManager } from '../src/state/stateManager';
import { TextElement } from '../src/types/index';

function makeTextElement(text: string): TextElement {
  return {
    id: 'para-style-sample',
    type: 'text',
    pageId: stateManager.getActiveSpread().pages[0].id,
    x: 20,
    y: 20,
    width: 100,
    height: 80,
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
  };
}

function getElement(id: string): TextElement {
  return stateManager.getActiveSpread().elements.find(e => e.id === id) as TextElement;
}

describe('Per-paragraph styles (Phase 0: bug reproduction)', () => {
  beforeEach(() => {
    stateManager.resetToDefault();
  });

  it('applying a paragraph style to ONE paragraph leaves the other paragraphs untouched', () => {
    stateManager.addElement(makeTextElement('Heading line\nFirst body paragraph\nSecond body paragraph'));

    // Third argument = indices of the paragraphs the style should be applied to.
    stateManager.applyParagraphStyle('para-style-sample', 'style-h1', [1]);

    const el = getElement('para-style-sample');

    // The frame as a whole must NOT take the style (this is the bug: it did).
    expect(el.paragraphStyleId).toBeUndefined();
    expect(el.fontSizePt).toBe(10);

    // Only paragraph #1 carries the style.
    expect(el.paragraphs).toHaveLength(3);
    expect(el.paragraphs![0].styleId).toBeUndefined();
    expect(el.paragraphs![1].styleId).toBe('style-h1');
    expect(el.paragraphs![2].styleId).toBeUndefined();
  });
});
