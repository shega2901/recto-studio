import { stateManager } from '../state';

/**
 * UI bridge for applying a paragraph style. If the target frame is being edited inline, the
 * style is applied to the paragraphs under the caret/selection; otherwise to the whole frame.
 */
export function applyParagraphStyleToSelection(elementId: string, styleId: string): void {
  const canvas = (window as any).recto?.spreadCanvas;
  const indices: number[] | undefined = canvas?.getActiveParagraphSelection?.(elementId) ?? undefined;
  stateManager.applyParagraphStyle(elementId, styleId, indices);
}
