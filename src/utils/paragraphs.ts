/**
 * Helpers for the per-paragraph text model.
 *
 * TextElement keeps two views of its content during the migration:
 *  - `paragraphs`: the per-paragraph source of truth for styling,
 *  - `text`: the same content joined with '\n', still read by legacy code.
 * Always change content through setPlainText / syncTextElement so they cannot drift apart.
 */
import type { Paragraph, TextElement } from '../types/index';

export function splitParagraphs(text: string): string[] {
  return text.split('\n');
}

function cloneParagraph(p: Paragraph, text: string): Paragraph {
  const copy: Paragraph = { text };
  if (p.styleId !== undefined) copy.styleId = p.styleId;
  if (p.overrides) copy.overrides = { ...p.overrides };
  return copy;
}

/**
 * Rebuilds the paragraph list for new plain text, carrying styles over from the old list.
 * Unchanged paragraphs at the start and end keep their style; inside the edited region
 * styles are matched by position, and extra paragraphs (Enter pressed) inherit the style
 * of the paragraph they were split from, as in InDesign.
 */
export function reconcileParagraphs(old: Paragraph[], newText: string): Paragraph[] {
  const next = splitParagraphs(newText);

  let start = 0;
  while (start < old.length && start < next.length && old[start].text === next[start]) start++;

  let oldEnd = old.length;
  let nextEnd = next.length;
  while (oldEnd > start && nextEnd > start && old[oldEnd - 1].text === next[nextEnd - 1]) {
    oldEnd--;
    nextEnd--;
  }

  const result: Paragraph[] = [];
  for (let i = 0; i < start; i++) result.push(cloneParagraph(old[i], next[i]));

  for (let i = start; i < nextEnd; i++) {
    const source =
      i < oldEnd ? old[i] :
      oldEnd > start ? old[oldEnd - 1] :
      start > 0 ? old[start - 1] :
      undefined;
    result.push(source ? cloneParagraph(source, next[i]) : { text: next[i] });
  }

  const suffixLength = old.length - oldEnd;
  for (let k = 0; k < suffixLength; k++) {
    result.push(cloneParagraph(old[oldEnd + k], next[nextEnd + k]));
  }

  return result;
}

function joinParagraphs(paragraphs: Paragraph[]): string {
  return paragraphs.map(p => p.text).join('\n');
}

/** Plain text of the element, paragraphs separated by '\n'. */
export function getPlainText(el: Pick<TextElement, 'text' | 'paragraphs'>): string {
  if (Array.isArray(el.paragraphs) && el.paragraphs.length > 0) {
    return joinParagraphs(el.paragraphs);
  }
  return el.text ?? '';
}

/** Replaces the element's content, keeping paragraph styles where the paragraphs survive. */
export function setPlainText(el: Pick<TextElement, 'text' | 'paragraphs'>, text: string): void {
  el.paragraphs = reconcileParagraphs(el.paragraphs ?? [], text);
  el.text = text;
}

/**
 * Makes `paragraphs` and `text` agree. Migrates legacy elements (no paragraphs yet) and
 * picks up edits made by legacy code that only wrote `text`.
 */
export function ensureParagraphs(el: Pick<TextElement, 'text' | 'paragraphs'>): Paragraph[] {
  const text = el.text ?? '';
  if (!Array.isArray(el.paragraphs) || el.paragraphs.length === 0) {
    el.paragraphs = splitParagraphs(text).map(t => ({ text: t }));
  } else if (joinParagraphs(el.paragraphs) !== text) {
    el.paragraphs = reconcileParagraphs(el.paragraphs, text);
  }
  return el.paragraphs;
}

/**
 * Call after merging a partial update into an element. When the update carried `paragraphs`
 * (new code) the text is rebuilt from them; otherwise `paragraphs` is rebuilt from `text`.
 */
export function syncTextElement(el: TextElement, updates?: Partial<TextElement>): void {
  if (updates && updates.paragraphs !== undefined && updates.text === undefined) {
    el.text = joinParagraphs(el.paragraphs ?? []);
  } else {
    ensureParagraphs(el);
  }
}

/** Style id that actually applies to a paragraph: its own, else the frame-level one. */
export function resolveParagraphStyleId(el: Pick<TextElement, 'paragraphStyleId'>, paragraph: Paragraph): string | undefined {
  return paragraph.styleId ?? el.paragraphStyleId;
}

/**
 * Paragraph indices (text split on '\n') touched by a caret or selection in a textarea.
 * A caret belongs to exactly one paragraph. A selection covers every paragraph it contains a
 * character of, where a paragraph's trailing '\n' counts as part of it; a selection that merely
 * ends where the next paragraph begins does not reach into that next paragraph.
 */
export function paragraphIndicesForRange(value: string, start: number | null, end: number | null): number[] | null {
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  const selStart = Math.min(start, end);
  const selEnd = Math.max(start, end);
  const collapsed = selStart === selEnd;
  const lines = value.split('\n');

  const indices: number[] = [];
  let charStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const charEnd = charStart + lines[i].length; // index of this paragraph's '\n' (or end of text)
    const touches = collapsed
      ? selStart >= charStart && selStart <= charEnd
      : selStart <= charEnd && selEnd > charStart;
    if (touches) indices.push(i);
    charStart = charEnd + 1;
  }
  return indices.length > 0 ? indices : null;
}
