/**
 * Resolves the effective typography of a single paragraph.
 *
 * Precedence (lowest to highest):
 *   1. the frame's own fields (TextElement.fontSizePt, .color, …) — also what legacy documents use,
 *   2. the paragraph's own style (Paragraph.styleId) — replaces the frame fields entirely,
 *   3. local overrides on the paragraph (Paragraph.overrides).
 *
 * Kept free of canvas/DOM code so it can be unit-tested and reused by exporters.
 */
import type {
  GrepStyleRule,
  OpenTypeFeatures,
  Paragraph,
  ParagraphOverrides,
  ParagraphStyle,
  TextElement,
} from '../types/index';
import { reconcileParagraphs } from './paragraphs';

export interface ParagraphFormat {
  fontFamily: string;
  fontSizePt: number;
  lineHeight: number;
  letterSpacingPt: number;
  color: string;
  alignment: 'left' | 'center' | 'right' | 'justify';
  snapToBaseline: boolean;
  dropCapLines: number;
  opticalMarginAlignment: boolean;
  openTypeFeatures?: OpenTypeFeatures;
  grepStyles?: GrepStyleRule[];
}

/** Format of the frame itself, i.e. what a paragraph without style or overrides looks like. */
export function frameParagraphFormat(el: TextElement, frameGrepStyles?: GrepStyleRule[]): ParagraphFormat {
  return {
    fontFamily: el.fontFamily || 'serif',
    fontSizePt: el.fontSizePt,
    lineHeight: el.lineHeight || 1.3,
    letterSpacingPt: el.letterSpacingPt || 0,
    color: el.color || '#111111',
    alignment: el.alignment || 'left',
    snapToBaseline: Boolean(el.snapToBaseline),
    dropCapLines: el.dropCapLines || 0,
    opticalMarginAlignment: Boolean(el.opticalMarginAlignment),
    openTypeFeatures: el.openTypeFeatures,
    grepStyles: frameGrepStyles,
  };
}

function formatFromStyle(style: ParagraphStyle): ParagraphFormat {
  return {
    fontFamily: style.fontFamily || 'serif',
    fontSizePt: style.fontSizePt,
    lineHeight: style.lineHeight || 1.3,
    letterSpacingPt: style.letterSpacingPt || 0,
    color: style.color || '#111111',
    alignment: style.alignment || 'left',
    snapToBaseline: Boolean(style.snapToBaseline),
    dropCapLines: style.dropCapLines || 0,
    opticalMarginAlignment: Boolean(style.opticalMarginAlignment),
    openTypeFeatures: style.openTypeFeatures,
    grepStyles: style.grepStyles,
  };
}

function applyOverrides(format: ParagraphFormat, overrides: ParagraphOverrides): ParagraphFormat {
  const out = { ...format };
  if (overrides.fontFamily !== undefined) out.fontFamily = overrides.fontFamily;
  if (overrides.fontSizePt !== undefined) out.fontSizePt = overrides.fontSizePt;
  if (overrides.lineHeight !== undefined) out.lineHeight = overrides.lineHeight;
  if (overrides.letterSpacingPt !== undefined) out.letterSpacingPt = overrides.letterSpacingPt;
  if (overrides.color !== undefined) out.color = overrides.color;
  if (overrides.alignment !== undefined) out.alignment = overrides.alignment;
  if (overrides.snapToBaseline !== undefined) out.snapToBaseline = overrides.snapToBaseline;
  if (overrides.dropCapLines !== undefined) out.dropCapLines = overrides.dropCapLines;
  if (overrides.opticalMarginAlignment !== undefined) out.opticalMarginAlignment = overrides.opticalMarginAlignment;
  if (overrides.openTypeFeatures !== undefined) out.openTypeFeatures = overrides.openTypeFeatures;
  if (overrides.grepStyles !== undefined) out.grepStyles = overrides.grepStyles;
  return out;
}

export function resolveParagraphFormat(
  el: TextElement,
  paragraph: Paragraph,
  styles: ParagraphStyle[],
  frameGrepStyles?: GrepStyleRule[],
): ParagraphFormat {
  const style = paragraph.styleId ? styles.find(s => s.id === paragraph.styleId) : undefined;
  let format = style ? formatFromStyle(style) : frameParagraphFormat(el, frameGrepStyles);
  if (paragraph.overrides) format = applyOverrides(format, paragraph.overrides);
  return format;
}

/** True when at least one paragraph deviates from the frame format; otherwise render exactly as before. */
export function hasParagraphVariation(paragraphs: Paragraph[] | undefined): boolean {
  return Boolean(paragraphs && paragraphs.some(p => p.styleId || (p.overrides && Object.keys(p.overrides).length > 0)));
}

/**
 * Paragraphs to draw, without mutating the element. Normally `el.paragraphs`; if some code wrote
 * `text` directly and `paragraphs` is stale, rebuild a matching list so styles stay attached.
 */
export function getParagraphsForRender(el: Pick<TextElement, 'text' | 'paragraphs'>): Paragraph[] | undefined {
  if (!Array.isArray(el.paragraphs) || el.paragraphs.length === 0) return undefined;
  const text = el.text ?? '';
  const joined = el.paragraphs.map(p => p.text).join('\n');
  return joined === text ? el.paragraphs : reconcileParagraphs(el.paragraphs, text);
}

/**
 * Compact signature of every paragraph's resolved format, for the text layout cache key.
 * Built from resolved values (not style ids) so editing a style definition also invalidates the cache.
 */
export function paragraphFormatsKey(formats: ParagraphFormat[]): string {
  const unique = new Map<string, number>();
  const order: number[] = [];
  for (const format of formats) {
    const key = JSON.stringify(format);
    let idx = unique.get(key);
    if (idx === undefined) {
      idx = unique.size;
      unique.set(key, idx);
    }
    order.push(idx);
  }
  return `${[...unique.keys()].join('|')}#${order.join(',')}`;
}
