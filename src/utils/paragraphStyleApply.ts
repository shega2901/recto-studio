import { stateManager } from '../state';
import type { TextElement } from '../types';
import { planParagraphStyleTarget, type InlineTextSelection } from './paragraphStyleTarget';

/**
 * UI bridge for applying a paragraph style. While the frame is being edited inline, the style goes
 * to the paragraphs under the caret / selection; otherwise to the whole frame.
 */
export function applyParagraphStyleToSelection(frameId: string, styleId: string): void {
  const canvas = (window as any).recto?.spreadCanvas;
  const selection: InlineTextSelection | null = canvas?.getActiveTextSelection?.(frameId) ?? null;

  if (selection) {
    const frame = stateManager.getElementById(frameId) as TextElement | null;
    const storyStart = selection.storyStart ?? frame?.storyStart ?? 0;
    const target = planParagraphStyleTarget(selection.text, selection.start, selection.end, storyStart);
    // Threaded frames edited together: "every paragraph" is the text of all of them, which the
    // frame-level style would not reach.
    const beyondFrame = selection.storyStart !== undefined && !!frame &&
      (selection.storyStart !== (frame.storyStart ?? 0) || selection.text.length !== (frame.text || '').length);
    if (target.kind === 'range' || beyondFrame) {
      const range = target.kind === 'range' ? target : { start: storyStart, end: storyStart + selection.text.length };
      stateManager.styleStoryRange(frameId, range.start, range.end, styleId);
      canvas?.resumeInlineTextEditor?.(frameId);
      return;
    }
  }
  stateManager.applyParagraphStyle(frameId, styleId);
  // Clicking the control closed the in-place editor; reopen it so typing continues in the new style.
  if (selection) canvas?.resumeInlineTextEditor?.(frameId);
}
