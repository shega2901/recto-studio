import { describe, expect, it } from 'vitest';
import { parseIdmlPackage } from '../src/idmlImport';
import { createZipArchive } from '../src/zip';
import type { TextElement, VectorPathElement } from '../src/types';

// The parts of an InDesign book export these tests rely on, written the way InDesign writes them.
const styles = `<Styles>
  <RootParagraphStyleGroup>
    <ParagraphStyle Self="ParagraphStyle/$ID/[No paragraph style]" Name="$ID/[No paragraph style]" PointSize="12"
      Leading="Auto" AutoLeading="120" GridAlignment="None" FontStyle="Regular" Tracking="0">
      <Properties><AppliedFont type="string">Minion Pro</AppliedFont></Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/$ID/NormalParagraphStyle" Name="$ID/NormalParagraphStyle">
      <Properties><BasedOn type="string">$ID/[No paragraph style]</BasedOn><AppliedFont type="string">Arial</AppliedFont></Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/Text" Name="Text" AutoLeading="130" Justification="LeftJustified">
      <Properties><BasedOn type="string">$ID/[No paragraph style]</BasedOn><AppliedFont type="string">Arial</AppliedFont></Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/Story" Name="Рассказ" FontStyle="Bold" PointSize="18" Justification="CenterAlign" Tracking="50">
      <Properties><BasedOn type="string">$ID/[No paragraph style]</BasedOn><AppliedFont type="string">Arial</AppliedFont></Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/Subtitle" Name="Подзаголовок" FontStyle="Bold Italic" PointSize="13">
      <Properties><BasedOn type="string">ParagraphStyle/Story</BasedOn></Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/Gridded" Name="На сетке" GridAlignment="AlignBaseline" Leading="14">
      <Properties><BasedOn type="string">ParagraphStyle/Text</BasedOn></Properties>
    </ParagraphStyle>
  </RootParagraphStyleGroup>
  <RootObjectStyleGroup>
    <ObjectStyle Self="ObjectStyle/$ID/[None]" Name="$ID/[None]" FillColor="Swatch/None" StrokeWeight="0" StrokeColor="Swatch/None"/>
    <ObjectStyle Self="ObjectStyle/$ID/[Normal Graphics Frame]" Name="$ID/[Normal Graphics Frame]" StrokeWeight="1" StrokeColor="Color/Black">
      <Properties><BasedOn type="string">$ID/[None]</BasedOn></Properties>
    </ObjectStyle>
    <ObjectStyle Self="ObjectStyle/line" Name="line" StrokeWeight="2">
      <Properties><BasedOn type="string">ObjectStyle/$ID/[Normal Graphics Frame]</BasedOn></Properties>
    </ObjectStyle>
  </RootObjectStyleGroup>
</Styles>`;

const graphic = `<Graphic><Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" Name="Black"/></Graphic>`;
const preferences = `<Preferences><DocumentPreference PageHeight="623.62" PageWidth="453.54" FacingPages="true"/>
  <GridPreference BaselineStart="36" BaselineDivision="14" BaselineGridRelativeOption="TopOfPageOfBaselineGridRelativeOption"/></Preferences>`;
const page = (self: string, master: string, x: number) =>
  `<Page Self="${self}" AppliedMaster="${master}" GeometricBounds="0 0 623.62 453.54" ItemTransform="1 0 0 1 ${x} -311.81"/>`;
const frame = (self: string, story: string, x: number) =>
  `<TextFrame Self="${self}" ParentStory="${story}" AppliedObjectStyle="ObjectStyle/$ID/[Normal Text Frame]" ItemTransform="1 0 0 1 ${x} -311.81">
    <Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>
      <PathPointType Anchor="40 60" LeftDirection="40 60" RightDirection="40 60"/><PathPointType Anchor="40 560" LeftDirection="40 560" RightDirection="40 560"/>
      <PathPointType Anchor="400 560" LeftDirection="400 560" RightDirection="400 560"/><PathPointType Anchor="400 60" LeftDirection="400 60" RightDirection="400 60"/>
    </PathPointArray></GeometryPathType></PathGeometry></Properties></TextFrame>`;
const story = (self: string, ranges: string) => `<Story Self="${self}">${ranges}</Story>`;
const range = (style: string, text: string) =>
  `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/${style}"><CharacterStyleRange><Content>${text}</Content><Br/></CharacterStyleRange></ParagraphStyleRange>`;

function book() {
  return createZipArchive({
    'designmap.xml': '<Document><idPkg:Spread src="Spreads/Spread_one.xml"/></Document>',
    'Resources/Styles.xml': styles,
    'Resources/Graphic.xml': graphic,
    'Resources/Preferences.xml': preferences,
    'MasterSpreads/MasterSpread_empty.xml': `<MasterSpread Self="empty" NamePrefix="A" BaseName="Parent">
      ${page('ea', '', -453.54)}${page('eb', '', 0)}</MasterSpread>`,
    'MasterSpreads/MasterSpread_head.xml': `<MasterSpread Self="head" NamePrefix="B" BaseName="Running head">
      ${page('ha', '', -453.54)}${page('hb', '', 0)}
      <GraphicLine Self="rule-left" AppliedObjectStyle="ObjectStyle/line" ItemTransform="1 0 0 1 -453.54 -311.81">
        <Properties><PathGeometry><GeometryPathType PathOpen="true"><PathPointArray>
          <PathPointType Anchor="56 45" LeftDirection="56 45" RightDirection="56 45"/><PathPointType Anchor="396 45" LeftDirection="396 45" RightDirection="396 45"/>
        </PathPointArray></GeometryPathType></PathGeometry></Properties></GraphicLine>
      <GraphicLine Self="rule-right" AppliedObjectStyle="ObjectStyle/line" ItemTransform="1 0 0 1 0 -311.81">
        <Properties><PathGeometry><GeometryPathType PathOpen="true"><PathPointArray>
          <PathPointType Anchor="56 45" LeftDirection="56 45" RightDirection="56 45"/><PathPointType Anchor="396 45" LeftDirection="396 45" RightDirection="396 45"/>
        </PathPointArray></GeometryPathType></PathGeometry></Properties></GraphicLine>
      ${frame('folio', 'folio-story', 0)}</MasterSpread>`,
    'Stories/Story_folio-story.xml': story('folio-story', range('Text', '<?ACE 18?>')),
    'Spreads/Spread_one.xml': `<Spread Self="one">${page('left', 'empty', -453.54)}${page('right', 'head', 0)}
      ${frame('imprint', 'imprint-story', -453.54)}${frame('chapter', 'chapter-story', 0)}</Spread>`,
    'Stories/Story_imprint-story.xml': story('imprint-story', range('$ID/NormalParagraphStyle', 'Imprint')),
    'Stories/Story_chapter-story.xml': story('chapter-story', range('Story', 'Налить кофе') + range('Text', 'Кофе по-израильски')),
  });
}

describe('InDesign styles on import', () => {
  it('inherits from the [No paragraph style] root that BasedOn names without its prefix', async () => {
    const project = await parseIdmlPackage(book(), 'book.idml');
    const text = project.paragraphStyles.find(style => style.name === 'Text')!;
    expect(text.fontSizePt).toBe(12);
    expect(text.fontFamily).toBe('Arial');
    expect(text.alignment).toBe('justify');
  });

  it('reads Auto leading as the percentage InDesign uses, 120 unless the style sets another', async () => {
    const project = await parseIdmlPackage(book(), 'book.idml');
    const named = (name: string) => project.paragraphStyles.find(style => style.name === name)!;
    expect(named('Рассказ').lineHeight).toBe(1.2);
    expect(named('Text').lineHeight).toBe(1.3);
    expect(named('На сетке').lineHeight).toBe(1.17);
  });

  it('snaps to the baseline grid only the styles set to align to it', async () => {
    const project = await parseIdmlPackage(book(), 'book.idml');
    const snapping = project.paragraphStyles.filter(style => style.id.startsWith('idml-')).map(style => [style.name, style.snapToBaseline]);
    expect(Object.fromEntries(snapping)).toEqual({ '[Basic Paragraph]': false, Text: false, 'Рассказ': false, 'Подзаголовок': false, 'На сетке': true });
  });

  it('carries the font style and tracking of a paragraph style', async () => {
    const project = await parseIdmlPackage(book(), 'book.idml');
    const named = (name: string) => project.paragraphStyles.find(style => style.name === name)!;
    expect(named('Рассказ')).toMatchObject({ bold: true, letterSpacingPt: 0.9 });
    expect(named('Рассказ').italic).toBeUndefined();
    expect(named('Подзаголовок')).toMatchObject({ bold: true, italic: true, fontSizePt: 13, alignment: 'center' });
    expect(named('Text').bold).toBeUndefined();
  });

  it('imports [Basic Paragraph] as a style the text using it keeps', async () => {
    const project = await parseIdmlPackage(book(), 'book.idml');
    const basic = project.paragraphStyles.find(style => style.name === '[Basic Paragraph]')!;
    expect(basic.fontFamily).toBe('Arial');
    const imprint = project.spreads[0].elements.find(element => element.id === 'idml-imprint') as TextElement;
    expect(imprint.storyContent?.paragraphs[0].styleId).toBe(basic.id);
  });

  it('takes the baseline grid from the document', async () => {
    const project = await parseIdmlPackage(book(), 'book.idml');
    expect(project.settings.baselineGrid).toEqual({ enabled: true, incrementPt: 14, startMm: 12.7 });
  });
});

describe('InDesign parents and page items on import', () => {
  it('writes the page number marker as the page token', async () => {
    const project = await parseIdmlPackage(book(), 'book.idml');
    const folio = project.masterSpreads.find(master => master.id === 'head')!.elements.find(element => element.type === 'text') as TextElement;
    expect(folio.text.trim()).toBe('{{page}}');
  });

  it('draws lines with the stroke their object style gives them', async () => {
    const project = await parseIdmlPackage(book(), 'book.idml');
    const rules = project.masterSpreads.find(master => master.id === 'head')!.elements.filter(element => element.type === 'path') as VectorPathElement[];
    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      expect(rule.strokeColor).not.toBe('transparent');
      expect(rule.strokeWidthMm).toBeCloseTo(2 * 25.4 / 72, 3);
    }
  });

  it('keeps a page that uses another parent free of the spread parent\'s items', async () => {
    const project = await parseIdmlPackage(book(), 'book.idml');
    const spread = project.spreads[0];
    const master = project.masterSpreads.find(item => item.id === 'head')!;
    // One page uses the empty parent, one the running head: the spread takes the one with artwork…
    expect(spread.masterSpreadId).toBe('head');
    // …and its items for the left page are detached, so only the right page shows the running head.
    const leftItems = master.elements.filter(element => element.pageId === master.pages.find(item => item.side === 'left')!.id).map(element => element.id);
    expect(leftItems.length).toBeGreaterThan(0);
    expect([...(spread.detachedMasterElementIds || [])].sort()).toEqual([...leftItems].sort());
  });
});
