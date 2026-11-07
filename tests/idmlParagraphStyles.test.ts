import { describe, it, expect } from 'vitest';
import { parseIdmlPackage } from '../src/idmlImport';
import { storyText } from '../src/engine/storyContent';
import { createZipArchive } from '../src/zip';
import { TextElement } from '../src/types';

const HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** Build a minimal IDML package around one story body, optionally with extra paragraph styles. */
function buildIdml(storyBody: string, stylesXml = ''): Uint8Array {
  const designmap = `${HEADER}
<Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="21.4">
  <idPkg:Spread src="Spreads/Spread_test.xml" />
</Document>`;
  const spread = `${HEADER}
<idPkg:Spread xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="21.4">
  <Spread Self="sp1">
    <Page Self="p1" GeometricBounds="0 0 841.89 595.276" />
    <TextFrame Self="tf1" ParentStory="story1" ItemTransform="1 0 0 1 0 0" GeometricBounds="0 0 200 400" />
  </Spread>
</idPkg:Spread>`;
  const story = `${HEADER}
<idPkg:Story xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="21.4">
  <Story Self="story1">
    ${storyBody}
  </Story>
</idPkg:Story>`;
  const files: Record<string, string> = {
    'designmap.xml': designmap,
    'Spreads/Spread_test.xml': spread,
    'Stories/Story_story1.xml': story,
  };
  if (stylesXml) {
    files['Resources/Styles.xml'] = `${HEADER}
<idPkg:Styles xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
  <RootParagraphStyleGroup Self="rpsg">${stylesXml}</RootParagraphStyleGroup>
</idPkg:Styles>`;
  }
  return createZipArchive(files);
}

/** A ParagraphStyleRange holding one paragraph of plain content. */
function para(styleName: string, text: string): string {
  return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/${styleName}">
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>${text}</Content></CharacterStyleRange>
  </ParagraphStyleRange>`;
}

async function importTextEl(storyBody: string, stylesXml = ''): Promise<TextElement> {
  const state = await parseIdmlPackage(buildIdml(storyBody, stylesXml), 'test.idml');
  const el = state.spreads.flatMap((s) => s.elements).find((e) => e.type === 'text') as TextElement | undefined;
  if (!el) throw new Error('no text frame imported');
  return el;
}

describe('IDML import — per-paragraph styles', () => {
  it('builds a StoryContent carrying each paragraph\'s own style when they differ', async () => {
    const el = await importTextEl(para('Headline 1', 'The headline') + para('Body Text', 'A body paragraph.'));

    expect(el.text).toBe('The headline\nA body paragraph.');
    expect(el.storyContent).toBeDefined();
    expect(el.storyContent!.paragraphs.map((p) => p.styleId)).toEqual(['style-h1', 'style-body']);
    expect(el.storyContent!.paragraphs.map((p) => p.runs.map((r) => r.text).join(''))).toEqual([
      'The headline',
      'A body paragraph.',
    ]);
    // The plain text and the story stay in sync.
    expect(storyText(el.storyContent!)).toBe(el.text);
  });

  it('keeps the simple path (no StoryContent) when every paragraph shares one style', async () => {
    const el = await importTextEl(para('Body Text', 'First line.') + para('Body Text', 'Second line.'));

    expect(el.text).toBe('First line.\nSecond line.');
    expect(el.storyContent).toBeUndefined();
    expect(el.paragraphStyleId).toBe('style-body');
  });

  it('marks a paragraph with no matched style as unstyled, next to a styled one', async () => {
    const el = await importTextEl(
      para('Headline 1', 'Heading') +
        `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">
          <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>Plain body</Content></CharacterStyleRange>
        </ParagraphStyleRange>`,
    );

    expect(el.storyContent).toBeDefined();
    expect(el.storyContent!.paragraphs.map((p) => p.styleId)).toEqual(['style-h1', undefined]);
  });

  it('gives each line of a <Br/> split the same paragraph style', async () => {
    const el = await importTextEl(
      `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Headline 1">
        <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>Line one</Content><Br /><Content>Line two</Content></CharacterStyleRange>
      </ParagraphStyleRange>` + para('Body Text', 'Body'),
    );

    expect(el.text).toBe('Line one\nLine two\nBody');
    expect(el.storyContent!.paragraphs.map((p) => p.styleId)).toEqual(['style-h1', 'style-h1', 'style-body']);
    expect(storyText(el.storyContent!)).toBe(el.text);
  });

  it('resolves a custom style defined in Resources/Styles.xml', async () => {
    const styles = '<ParagraphStyle Self="ps-callout" Name="Callout" PointSize="18" />';
    const el = await importTextEl(para('Callout', 'A callout') + para('Body Text', 'Body'), styles);

    expect(el.storyContent).toBeDefined();
    expect(el.storyContent!.paragraphs.map((p) => p.styleId)).toEqual(['idml-style-callout', 'style-body']);
  });

  it('records the source style name even when it does not match a known style', async () => {
    const el = await importTextEl(para('Unknown Deck', 'Deck text') + para('Body Text', 'Body'));

    const decks = el.storyContent!.paragraphs[0];
    expect(decks.styleId).toBeUndefined();
    expect(decks.sourceStyle).toBe('Unknown Deck');
  });

  it('decodes XML entities inside story runs', async () => {
    const el = await importTextEl(para('Headline 1', 'Tom &amp; Jerry') + para('Body Text', 'A &lt; B'));

    expect(el.storyContent!.paragraphs.map((p) => p.runs[0].text)).toEqual(['Tom & Jerry', 'A < B']);
    expect(storyText(el.storyContent!)).toBe(el.text);
  });
});

import { stateManager } from '../src/state/stateManager';

describe('IDML import — per-paragraph styles through loadFromIdml', () => {
  it('derives per-frame textContent so a mixed-style story renders', async () => {
    const body = para('Headline 1', 'The headline') + para('Body Text', 'A body paragraph.');
    await stateManager.loadFromIdml(buildIdml(body), 'test.idml');

    const el = stateManager
      .getState()
      .spreads.flatMap((s) => s.elements)
      .find((e) => e.type === 'text') as TextElement | undefined;

    expect(el).toBeDefined();
    // reflowFormattedStories ran: the frame now has a laid-out textContent slice.
    expect(el!.textContent).toBeDefined();
    expect(el!.textContent!.paragraphs.map((p) => p.styleId)).toEqual(['style-h1', 'style-body']);
    expect(el!.text).toBe('The headline\nA body paragraph.');
  });
});
