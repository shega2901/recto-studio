// A separate file, so the Russian dictionary starts out not loaded.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StateManager } from '../src/state/stateManager';
import { prepareStoryComposition } from '../src/engine/storyComposition';
import { loadHyphenation } from '../src/engine/languageHyphenation';
import type { ParagraphStyle, TextElement } from '../src/types';

// Long enough (8,000 characters) for the editor to compose it in the background worker.
const WORDS = 'Переносы издательство типографика '.repeat(250).trim();
const russian: ParagraphStyle = { id: 'ru-body', name: 'Текст', fontFamily: 'Times', fontSizePt: 11, lineHeight: 1.4,
  letterSpacingPt: 0, color: '#111111', alignment: 'left', snapToBaseline: false, hyphenate: true, language: 'ru' };

function addFrame(manager: StateManager, id: string, height: number): TextElement {
  const frame: TextElement = { id, type: 'text', pageId: manager.getActiveSpread().pages[0].id,
    x: 25, y: 25, width: 32, height, rotation: 0, opacity: 1, zIndex: 1, locked: false,
    text: '', fontFamily: 'Times', fontSizePt: 11, lineHeight: 1.4, letterSpacingPt: 0,
    color: '#111111', alignment: 'left', columns: 1, columnGutterMm: 4, paddingMm: 0,
    backgroundColor: 'transparent', borderColor: 'transparent', borderWidthMm: 0 };
  manager.addElement(frame); return frame;
}

const splitsInsideWord = (first: string, second: string) => /\p{L}$/u.test(first) && /^\p{L}/u.test(second);

describe('Russian hyphenation in story layout', () => {
  let manager: StateManager;
  beforeEach(() => {
    manager = new StateManager();
    manager.createBlankProject('A4', 'Hyphenation test', false);
    manager.createParagraphStyle(russian);
    addFrame(manager, 'first', 11);
    addFrame(manager, 'second', 120);
    manager.linkTextFrames('first', 'second');
    manager.setStoryContent('first', { version: 1, paragraphs: [{ styleId: russian.id, runs: [{ text: WORDS }] }] });
  });

  it('composes a story in the background with the dictionary it needs, loaded there first', async () => {
    const head = manager.getElementById('first') as TextElement;
    const request = await prepareStoryComposition(manager.getState(), head, WORDS);
    expect(request).not.toBeNull();
    // A worker starts with fresh modules, where no dictionary has been loaded yet.
    vi.resetModules();
    const worker = await import('../src/engine/storyComposition');
    const composed = await worker.composeStoryInBackground(structuredClone(request!));
    const text = (id: string) => composed!.frames.find(frame => frame.id === id)?.text ?? '';
    expect(WORDS.startsWith(text('first') + text('second'))).toBe(true);
    expect(splitsInsideWord(text('first'), text('second'))).toBe(true);
  });

  it('composes again only the stories a newly loaded dictionary hyphenates', async () => {
    addFrame(manager, 'english', 40);
    manager.setStoryContent('english', { version: 1, paragraphs: [{ runs: [{ text: 'English copy.' }] }] });
    await loadHyphenation('ru');
    const reflow = vi.spyOn(manager, 'reflowStory');
    try {
      expect(manager.refreshLayoutForHyphenation('ru')).toBe(true);
      expect(reflow.mock.calls.map(([id]) => id)).toEqual(['first']);
      expect(manager.refreshLayoutForHyphenation('de')).toBe(false);
    } finally { reflow.mockRestore(); }
    const text = (id: string) => (manager.getElementById(id) as TextElement).text;
    expect(splitsInsideWord(text('first'), text('second'))).toBe(true);
  });
});
