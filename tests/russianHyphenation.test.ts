import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseTexPatterns } from '../src/engine/hyphenation/texPatterns';
import { hyphenateLanguage, hyphenationGeneration, loadHyphenation, onHyphenationLoaded } from '../src/engine/languageHyphenation';
import { documentHyphenationLanguages, storyHeadsHyphenatedIn } from '../src/engine/documentLanguages';
import { layoutStory } from '../src/engine/storyLayout';
import { plainStory, storyText } from '../src/engine/storyContent';
import { inDesignLanguage, parseIdmlPackage } from '../src/idmlImport';
import { createZipArchive } from '../src/zip';
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

describe('InDesign language on import', () => {
  it('maps InDesign language names to the dictionaries Recto has', () => {
    expect(inDesignLanguage('$ID/Russian')).toBe('ru');
    expect(inDesignLanguage('$ID/English: USA')).toBe('en-US');
    expect(inDesignLanguage('$ID/English: UK')).toBe('en-US');
    expect(inDesignLanguage('$ID/German: 2006 Reform')).toBe('de');
    expect(inDesignLanguage('$ID/French: Canadian')).toBe('fr');
    expect(inDesignLanguage('$ID/[No Language]')).toBeUndefined();
    expect(inDesignLanguage('$ID/Ukrainian')).toBeUndefined();
  });

  it('imports the language and hyphenation of styles and paragraphs', async () => {
    const styles = `<Styles><RootParagraphStyleGroup>
      <ParagraphStyle Self="ParagraphStyle/$ID/[No paragraph style]" Name="$ID/[No paragraph style]" PointSize="12"
        AppliedLanguage="$ID/Russian" Hyphenation="true"/>
      <ParagraphStyle Self="ParagraphStyle/Text" Name="Text"><Properties><BasedOn type="string">$ID/[No paragraph style]</BasedOn></Properties></ParagraphStyle>
      <ParagraphStyle Self="ParagraphStyle/Title" Name="Title" Hyphenation="false"><Properties><BasedOn type="string">$ID/[No paragraph style]</BasedOn></Properties></ParagraphStyle>
      <ParagraphStyle Self="ParagraphStyle/English" Name="English" AppliedLanguage="$ID/English: USA"><Properties><BasedOn type="string">Text</BasedOn></Properties></ParagraphStyle>
    </RootParagraphStyleGroup></Styles>`;
    const range = (style: string, ranges: string, local = '') =>
      `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/${style}"${local}>${ranges}<Br/></ParagraphStyleRange>`;
    const characters = (text: string, language = '') =>
      `<CharacterStyleRange${language ? ` AppliedLanguage="${language}"` : ''}><Content>${text}</Content></CharacterStyleRange>`;
    const idml = createZipArchive({
      'designmap.xml': '<Document><idPkg:Spread src="Spreads/Spread_one.xml"/></Document>',
      'Resources/Styles.xml': styles,
      'Resources/Preferences.xml': '<Preferences><DocumentPreference PageHeight="623.62" PageWidth="453.54" FacingPages="false"/></Preferences>',
      'Spreads/Spread_one.xml': `<Spread Self="one"><Page Self="p" GeometricBounds="0 0 623.62 453.54" ItemTransform="1 0 0 1 0 -311.81"/>
        <TextFrame Self="text" ParentStory="story" ItemTransform="1 0 0 1 0 -311.81"><Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>
          <PathPointType Anchor="40 60" LeftDirection="40 60" RightDirection="40 60"/><PathPointType Anchor="40 560" LeftDirection="40 560" RightDirection="40 560"/>
          <PathPointType Anchor="400 560" LeftDirection="400 560" RightDirection="400 560"/><PathPointType Anchor="400 60" LeftDirection="400 60" RightDirection="400 60"/>
        </PathPointArray></GeometryPathType></PathGeometry></Properties></TextFrame></Spread>`,
      'Stories/Story_story.xml': `<Story Self="story">${
        range('Text', characters('Русский абзац')) +
        // An English quotation pasted into Russian text: most of the paragraph is English.
        range('Text', characters('«', '$ID/Russian') + characters('The quick brown fox jumps', '$ID/English: USA') + characters('»', '$ID/Russian')) +
        range('Text', characters('Silbentrennung'), ' AppliedLanguage="$ID/German: 2006 Reform"') +
        range('English', characters('English text'))
      }</Story>`,
    });
    const project = await parseIdmlPackage(idml, 'languages.idml');
    const named = (name: string) => project.paragraphStyles.find(style => style.name === name)!;
    expect(named('Text')).toMatchObject({ language: 'ru', hyphenate: true });
    expect(named('Title')).toMatchObject({ language: 'ru', hyphenate: false });
    expect(named('English')).toMatchObject({ language: 'en-US', hyphenate: true });

    const text = project.spreads.flatMap(spread => spread.elements).find(element => element.type === 'text') as TextElement;
    const paragraphs = text.storyContent!.paragraphs;
    expect(paragraphs.map(paragraph => paragraph.language)).toEqual([undefined, 'en-US', 'de', undefined]);
  });
});
