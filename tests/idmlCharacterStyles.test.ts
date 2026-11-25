import { describe, expect, it } from 'vitest';
import { parseIdmlPackage } from '../src/idmlImport';
import { resolveRunStyle } from '../src/engine/storyLayout';
import { createZipArchive } from '../src/zip';
import type { TextElement } from '../src/types';

const styles = `<Styles><RootCharacterStyleGroup>
  <CharacterStyle Self="CharacterStyle/$ID/[No character style]" Name="$ID/[No character style]"/>
  <CharacterStyle Self="CharacterStyle/Accent" Name="Accent" FillColor="Color/Red"/>
  <CharacterStyle Self="CharacterStyle/Strong accent" Name="Strong accent" FontStyle="Bold">
    <Properties><BasedOn type="string">CharacterStyle/Accent</BasedOn></Properties>
  </CharacterStyle>
  <CharacterStyle Self="CharacterStyle/Plain" Name="Plain" FontStyle="Regular" PointSize="9" Underline="true">
    <Properties><AppliedFont type="string">Arial</AppliedFont></Properties>
  </CharacterStyle>
</RootCharacterStyleGroup></Styles>`;

const characters = (text: string, attributes = '') => `<CharacterStyleRange${attributes}><Content>${text}</Content></CharacterStyleRange>`;

function book() {
  return createZipArchive({
    'designmap.xml': '<Document><idPkg:Spread src="Spreads/Spread_one.xml"/></Document>',
    'Resources/Styles.xml': styles,
    'Resources/Graphic.xml': `<Graphic>
      <Color Self="Color/Red" Model="Process" Space="CMYK" ColorValue="0 100 100 0" Name="Red"/>
      <Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" Name="Black"/></Graphic>`,
    'Resources/Preferences.xml': '<Preferences><DocumentPreference PageHeight="623.62" PageWidth="453.54" FacingPages="false"/></Preferences>',
    'Spreads/Spread_one.xml': `<Spread Self="one"><Page Self="p" GeometricBounds="0 0 623.62 453.54" ItemTransform="1 0 0 1 0 -311.81"/>
      <TextFrame Self="text" ParentStory="story" ItemTransform="1 0 0 1 0 -311.81"><Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>
        <PathPointType Anchor="40 60" LeftDirection="40 60" RightDirection="40 60"/><PathPointType Anchor="40 560" LeftDirection="40 560" RightDirection="40 560"/>
        <PathPointType Anchor="400 560" LeftDirection="400 560" RightDirection="400 560"/><PathPointType Anchor="400 60" LeftDirection="400 60" RightDirection="400 60"/>
      </PathPointArray></GeometryPathType></PathGeometry></Properties></TextFrame></Spread>`,
    'Stories/Story_story.xml': `<Story Self="story"><ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">${
      characters('Дверь ', ' AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"') +
      characters('вовнутрь', ' AppliedCharacterStyle="CharacterStyle/Accent"') +
      characters(' никогда ') +
      // Colour set on the text itself overrides its character style's, as in InDesign.
      characters('чёрное', ' AppliedCharacterStyle="CharacterStyle/Accent" FillColor="Color/Black"') +
      characters(' жирное', ' AppliedCharacterStyle="CharacterStyle/Strong accent"')
    }<Br/></ParagraphStyleRange></Story>`,
  });
}

describe('InDesign character styles on import', () => {
  it('imports character styles with what they set and inherit through BasedOn', async () => {
    const project = await parseIdmlPackage(book(), 'characters.idml');
    const named = (name: string) => project.characterStyles!.find(style => style.name === name)!;
    // The built-in [No character style] is not a style of its own.
    expect(project.characterStyles!.map(style => style.name)).toEqual(['Accent', 'Strong accent', 'Plain']);
    const red = named('Accent').color;
    expect(red).toMatch(/^#[0-9a-f]{6}$/i);
    expect(red).not.toBe('#000000');
    expect(named('Strong accent')).toMatchObject({ color: red, bold: true, italic: false });
    // "Regular" turns bold and italic off rather than leaving them to the paragraph.
    expect(named('Plain')).toMatchObject({ bold: false, italic: false, fontSizePt: 9, underline: true, fontFamily: 'Arial' });
  });

  it('keeps the character style of each piece of text, with the text\'s own attributes over it', async () => {
    const project = await parseIdmlPackage(book(), 'characters.idml');
    const frame = project.spreads.flatMap(spread => spread.elements).find(element => element.type === 'text') as TextElement;
    const runs = frame.storyContent!.paragraphs[0].runs;
    const run = (text: string) => runs.find(item => item.text.trim() === text)!;
    const styleOf = (text: string) => project.characterStyles!.find(style => style.id === run(text).characterStyleId)?.name;
    expect(styleOf('вовнутрь')).toBe('Accent');
    expect(styleOf('Дверь')).toBeUndefined();
    expect(styleOf('никогда')).toBeUndefined();
    expect(styleOf('жирное')).toBe('Strong accent');

    const drawn = (text: string) => resolveRunStyle(frame, undefined, run(text), project.characterStyles!);
    const red = project.characterStyles!.find(style => style.name === 'Accent')!.color;
    expect(drawn('вовнутрь').color).toBe(red);
    expect(drawn('чёрное').color).toBe('#000000');
    expect(drawn('жирное')).toMatchObject({ color: red, bold: true });
  });
});
