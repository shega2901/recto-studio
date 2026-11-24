import { expect, test } from '@playwright/test';
import { importProject, projectFixture } from './fixtures';

// The Russian dictionary is loaded on demand, outside the startup bundle.
const DICTIONARY = /\/ru[-.][^/]*\.(js|ts)(\?|$)/;
const WORDS = 'Переносы издательство типографика переносы издательство типографика переносы издательство типографика';

function russianBook() {
  const project = projectFixture();
  const [sample] = project.spreads[0].elements;
  const frame = { ...sample, text: '', fontSizePt: 12, paddingMm: 0 };
  return {
    ...project,
    selectedElementId: null, selectedElementIds: [],
    paragraphStyles: [{ id: 'ru-body', name: 'Текст', fontFamily: 'Georgia, serif', fontSizePt: 12, lineHeight: 1.3,
      letterSpacingPt: 0, color: '#111111', alignment: 'left', snapToBaseline: false, hyphenate: true, language: 'ru' }],
    spreads: [{
      ...project.spreads[0],
      // One story in two linked frames: the first holds two lines, so the story splits between them.
      elements: [
        { ...frame, id: 'ru-first', x: 25, y: 35, width: 40, height: 11, nextFrameId: 'ru-second',
          storyContent: { version: 1, paragraphs: [{ styleId: 'ru-body', runs: [{ text: WORDS }] }] } },
        { ...frame, id: 'ru-second', x: 25, y: 60, width: 40, height: 120, prevFrameId: 'ru-first' },
      ],
    }],
  };
}

test('loads the Russian dictionary only for a document that hyphenates Russian, then breaks words between frames', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', request => { if (DICTIONARY.test(request.url())) requested.push(request.url()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');
  await importProject(page);
  expect(requested).toEqual([]);

  await importProject(page, russianBook() as unknown as ReturnType<typeof projectFixture>);
  await expect.poll(() => requested.length).toBeGreaterThan(0);
  const texts = () => page.evaluate(() => ['ru-first', 'ru-second']
    .map(id => (window as any).recto.stateManager.getElementById(id).text as string));
  // Once the dictionary is there the story is composed again and the first frame ends inside a word.
  await expect.poll(async () => {
    const [first, second] = await texts();
    return /\p{L}$/u.test(first) && /^\p{L}/u.test(second);
  }).toBe(true);
  const [first, second] = await texts();
  expect(first + second).toBe(WORDS);
});
