/**
 * In-place text editing on the canvas.
 *
 * A textarea still owns the text, the selection and every input method (keyboard, IME, clipboard,
 * its own undo), but it is invisible. The canvas draws the frame from the textarea's current value
 * with the document's composer, so each paragraph shows its own style while typing, and this class
 * paints the selection, positions the caret and maps clicks and vertical keys onto the composed lines.
 *
 * Threaded frames on the same spread are edited as one text: it reflows from frame to frame on every
 * keystroke, and the caret and the selection cross from one frame into the next.
 */
import type { StoryContent, TextElement } from '../../types';
import type { StoryLine } from '../storyLayout';
import { editStory } from '../storyContent';
import { applyTextEdit, lineOffsetAt, locateCaret, neighbourLine, offsetAtPoint, paragraphRangeAt, replayEdits,
  selectionRects, textEdit, wordRangeAt, type CaretAffinity, type LiveLine, type TextEdit } from '../liveTextEditing';

const PT = 25.4 / 72;
const STORAGE_KEY = 'recto.liveTextEditing';

/** In-place editing is on unless it was switched off; the textarea editor remains the fallback. */
export function liveTextEditingEnabled(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) !== 'off'; } catch { return true; }
}

export function setLiveTextEditingEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, 'off');
  } catch { /* Private browsing: the choice lasts for this page only. */ }
}

/** One frame of the text being edited: its lines for drawing and for the caret. */
export interface LivePart {
  frame: TextElement;
  lines: StoryLine[];
  /** The same lines, with offsets in the edited text. Geometry is local to the frame. */
  live: LiveLine[];
  overset: boolean;
  /** Plain frames hang their text from the top of the line, as the legacy renderer draws them. */
  topBaseline: boolean;
}

export interface LiveTextComposition {
  content: StoryContent;
  parts: LivePart[];
}

/** The committed text the editor works on: one frame, or the threaded frames edited together. */
export interface LiveTextBase {
  /** Identity of what the document currently shows there; differs once the document recomposed it. */
  key: readonly unknown[];
  text: string;
  /** Its formatted content, or null for a plain frame. Only asked for when `key` changes. */
  content(): StoryContent | null;
  /** Where the text begins in its story, when it is part of one. */
  start?: number;
}

export type LiveTextFormat = 'bold' | 'italic' | 'underline';

/**
 * What the canvas should bring into view after a paint: the caret, or, when the caret has moved
 * past everything the edited frames show, the offset it is at so the view can follow the story.
 */
export type LiveTextReveal = { caret: { x: number; y: number; height: number } } | { beyond: number };

/** Frame position on the canvas, in CSS pixels from the canvas corner. */
export interface LiveTextBox { x: number; y: number; pxPerMm: number }

export interface LiveTextHost {
  parent: HTMLElement;
  /** Null once the frame is gone. */
  base(): LiveTextBase | null;
  /** `content` is the edited formatted story, or null for a plain frame. */
  compose(value: string, content: StoryContent | null): LiveTextComposition;
  box(frame: TextElement): LiveTextBox;
  requestRender(): void;
  /** `toUi` is set when focus moved to a control outside the canvas. */
  close(commit: boolean, toUi?: boolean): void;
  /**
   * The caret is leaving the edited frames at `offset`, towards the start (-1) or the end (1) of
   * the story. Returns true when the story continues elsewhere and editing moved there.
   */
  follow(offset: number, direction: -1 | 1): boolean;
  /** Toggle character formatting on the selection. */
  format(kind: LiveTextFormat): void;
}

export interface LiveTextOpenOptions {
  /** Restore this selection instead of selecting everything. */
  selection?: { start: number; end: number };
  /** Put the caret under this pointer position (client coordinates). */
  point?: { clientX: number; clientY: number };
  /** Put the caret at this offset of the story, as when editing follows the text to another spread. */
  storyOffset?: number;
  affinity?: CaretAffinity;
}

type DragMode = 'character' | 'word' | 'paragraph';
type Hit = { offset: number; affinity: CaretAffinity };

const sameKey = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((item, index) => item === b[index]);

export class LiveTextEditor {
  public readonly textarea: HTMLTextAreaElement;
  private readonly caret: HTMLDivElement;
  private readonly lifetime = new AbortController();
  private affinity: CaretAffinity = 'start';
  /** Horizontal position Up and Down aim for, in canvas pixels, so it carries from frame to frame. */
  private goalX: number | null = null;
  private known = { start: 0, end: 0 };
  private drag: { mode: DragMode; start: number; end: number } | null = null;
  private composed: { value: string; result: LiveTextComposition } | null = null;
  private committedText: string;
  /** Edits since `committedText`, and the formatted content they produce from the document's own. */
  private edits: TextEdit[] = [];
  private lastValue: string;
  private draft: { key: readonly unknown[]; content: StoryContent | null; value: string } | null = null;
  private compositionStart: number | null = null;
  private caretKey = '';
  private caretPainted = false;
  /** The caret moved by typing or the keyboard since the last paint, so the view should show it. */
  private reveal = false;
  private closed = false;

  constructor(private readonly host: LiveTextHost, public readonly elementId: string, frame: TextElement,
    canvas: HTMLCanvasElement, options: LiveTextOpenOptions = {}) {
    this.committedText = this.lastValue = host.base()?.text ?? frame.text ?? '';

    const textarea = document.createElement('textarea');
    textarea.className = 'canvas-inline-editor canvas-inline-editor--live';
    textarea.value = this.committedText;
    textarea.spellcheck = false;
    textarea.setAttribute('aria-label', 'Text frame content');
    textarea.style.position = 'absolute';
    textarea.style.boxSizing = 'border-box';
    textarea.style.fontFamily = frame.fontFamily || 'Inter, system-ui, sans-serif';
    this.textarea = textarea;

    this.caret = document.createElement('div');
    this.caret.className = 'canvas-live-caret';
    this.caret.style.display = 'none';

    const listen = { signal: this.lifetime.signal };
    textarea.addEventListener('keydown', event => this.handleKeyDown(event), listen);
    textarea.addEventListener('input', () => {
      this.recordEdit();
      this.affinity = 'start';
      this.goalX = null;
      this.reveal = true;
      this.known = { start: textarea.selectionStart, end: textarea.selectionEnd };
      this.host.requestRender();
    }, listen);
    textarea.addEventListener('compositionstart', () => { this.compositionStart = textarea.selectionStart; }, listen);
    textarea.addEventListener('compositionend', () => { this.compositionStart = null; this.host.requestRender(); }, listen);
    textarea.addEventListener('select', () => this.noteSelection(), listen);
    textarea.addEventListener('keyup', () => this.noteSelection(), listen);
    document.addEventListener('selectionchange', () => this.noteSelection(), listen);
    textarea.addEventListener('blur', event => {
      if (this.closed) return;
      const next = event.relatedTarget;
      this.host.close(true, next instanceof HTMLElement && !canvas.contains(next));
    }, listen);

    host.parent.append(textarea, this.caret);
    this.place(frame, host.box(frame));
    textarea.focus({ preventScroll: true });

    const length = textarea.value.length;
    if (options.storyOffset !== undefined) {
      const offset = Math.max(0, Math.min(options.storyOffset - (host.base()?.start ?? 0), length));
      this.select(offset, offset, options.affinity, true);
    } else if (options.selection) {
      this.select(Math.min(options.selection.start, length), Math.min(options.selection.end, length), 'start', true);
    } else if (options.point) {
      const bounds = canvas.getBoundingClientRect();
      const hit = this.hit(options.point.clientX - bounds.left, options.point.clientY - bounds.top);
      this.select(hit?.offset ?? length, hit?.offset ?? length, hit?.affinity);
    } else {
      this.select(0, length);
    }
  }

  public get value(): string { return this.textarea.value; }
  public get selection(): { start: number; end: number } {
    return { start: this.textarea.selectionStart, end: this.textarea.selectionEnd };
  }

  /** The end of the selection that moves; the anchor is the end that stays. */
  private get focusOffset(): number {
    return this.textarea.selectionDirection === 'backward' ? this.textarea.selectionStart : this.textarea.selectionEnd;
  }
  private get anchorOffset(): number {
    return this.textarea.selectionDirection === 'backward' ? this.textarea.selectionEnd : this.textarea.selectionStart;
  }

  private select(anchor: number, focus: number, affinity: CaretAffinity = 'start', reveal = false) {
    const start = Math.min(anchor, focus), end = Math.max(anchor, focus);
    this.textarea.setSelectionRange(start, end, focus < anchor ? 'backward' : 'forward');
    this.known = { start, end };
    this.affinity = affinity;
    if (reveal) this.reveal = true;
    this.host.requestRender();
  }

  /** The textarea moved its own caret (typing, Left/Right, word jumps): drop our line bookkeeping. */
  private noteSelection() {
    const { selectionStart: start, selectionEnd: end } = this.textarea;
    if (start === this.known.start && end === this.known.end) return;
    this.known = { start, end };
    this.affinity = 'start';
    this.goalX = null;
    this.reveal = true;
    this.host.requestRender();
  }

  /** The pending text is being stored in the document: from here on it is the committed text. */
  public markCommitted() {
    this.committedText = this.lastValue = this.textarea.value;
    this.edits = [];
    this.draft = null;
  }

  /** Each input event is one contiguous change; fold it into the formatted draft straight away. */
  private recordEdit() {
    const value = this.textarea.value;
    if (value === this.lastValue) return;
    // After typing, deleting or pasting the caret sits at the end of what changed.
    const edit = textEdit(this.lastValue, value, this.textarea.selectionEnd);
    this.edits.push(edit);
    this.lastValue = value;
    const base = this.host.base();
    if (this.draft?.content && base && sameKey(this.draft.key, base.key)) {
      this.draft = { key: this.draft.key, value, content: applyTextEdit(this.draft.content, edit) };
    }
  }

  /**
   * The formatted content with this session's edits applied, or null for a plain frame.
   * Paragraph styles and character formatting outside each edit are exactly the document's.
   */
  public content(): StoryContent | null {
    const base = this.host.base();
    if (!base) return this.draft?.content ?? null;
    const value = this.textarea.value;
    if (this.draft && sameKey(this.draft.key, base.key)) {
      if (this.draft.content && this.draft.value !== value) {
        this.draft = { key: base.key, value, content: editStory(this.draft.content, value) };
      }
      return this.draft.content;
    }
    const content = base.content();
    // The document recomposed these frames (or the session just began): replay our edits on its content.
    this.draft = { key: base.key, value, content: !content ? null
      : base.text === this.committedText ? replayEdits(content, this.edits) : editStory(content, value) };
    return this.draft.content;
  }

  /** Compose the edited frames from the current text. The canvas calls this once per paint. */
  public compose(): LiveTextComposition {
    const value = this.textarea.value;
    const result = this.host.compose(value, this.content());
    this.composed = { value, result };
    this.caretPainted = false;
    return result;
  }

  /** Composition for input handling: reuse the last paint unless the text changed since. */
  private current(): LiveTextComposition {
    return this.composed?.value === this.textarea.value ? this.composed.result : this.compose();
  }

  /** The frame under a canvas point; with `nearest`, the closest one when the point is outside them all. */
  private partAt(canvasX: number, canvasY: number, nearest: boolean) {
    let best: { part: LivePart; x: number; y: number } | null = null, distance = Infinity;
    for (const part of this.current().parts) {
      const box = this.host.box(part.frame);
      const x = (canvasX - box.x) / box.pxPerMm, y = (canvasY - box.y) / box.pxPerMm;
      const gap = Math.hypot(Math.max(0, -x, x - part.frame.width), Math.max(0, -y, y - part.frame.height));
      if (gap === 0) return { part, x, y };
      if (nearest && gap < distance) { distance = gap; best = { part, x, y }; }
    }
    return best;
  }

  private hit(canvasX: number, canvasY: number, nearest = false): Hit | null {
    const target = this.partAt(canvasX, canvasY, nearest);
    if (!target) return null;
    const length = this.textarea.value.length;
    const found = offsetAtPoint(target.part.live, target.part.frame, target.x, target.y);
    // A frame the text does not reach, or text that belongs to frames further on: the end of ours.
    if (!found || found.offset > length) return { offset: length, affinity: 'start' };
    return found;
  }

  private place(frame: TextElement, box: LiveTextBox) {
    // The textarea covers the frame, but never leaves the visible canvas: a focused field outside it
    // would make the browser scroll the canvas container to reveal it on the next keystroke.
    const span = (start: number, size: number, limit: number) => {
      const from = Math.max(0, Math.min(start, limit - 24));
      return [from, Math.max(24, Math.min(start + size, limit) - from)];
    };
    const [left, width] = span(Math.round(box.x), Math.max(80, Math.round(frame.width * box.pxPerMm)), this.host.parent.clientWidth);
    const [top, height] = span(Math.round(box.y), Math.max(40, Math.round(frame.height * box.pxPerMm)), this.host.parent.clientHeight);
    const style = this.textarea.style;
    style.left = `${left}px`;
    style.top = `${top}px`;
    style.width = `${width}px`;
    style.height = `${height}px`;
  }

  /**
   * Paint one frame's share of the selection under its text, and the caret if it is in this frame.
   * Called by the canvas before it draws that frame's lines.
   */
  public paint(ctx: CanvasRenderingContext2D, part: LivePart, box: LiveTextBox) {
    const frame = part.frame;
    if (frame.id === this.elementId) this.place(frame, box);
    const { start, end } = this.selection;
    const focused = document.activeElement === this.textarea;
    if (end > start) {
      ctx.save();
      ctx.fillStyle = focused ? 'rgba(13, 153, 255, 0.32)' : 'rgba(128, 128, 128, 0.3)';
      for (const rect of selectionRects(part.live, start, end)) {
        ctx.fillRect(box.x + rect.x * box.pxPerMm, box.y + rect.y * box.pxPerMm, rect.width * box.pxPerMm, rect.height * box.pxPerMm);
      }
      ctx.restore();
    }
    if (this.compositionStart !== null && end > this.compositionStart) {
      // Mark text an input method is still composing, as a native field would.
      ctx.save();
      ctx.fillStyle = frame.color || '#111111';
      for (const rect of selectionRects(part.live, this.compositionStart, end)) {
        ctx.fillRect(box.x + rect.x * box.pxPerMm, box.y + (rect.y + rect.height) * box.pxPerMm - 2, rect.width * box.pxPerMm, 1);
      }
      ctx.restore();
    }

    const parts = this.composed?.result.parts;
    const located = parts && focused && start === end ? locateCaret(parts, this.focusOffset, this.affinity) : null;
    if (!located || parts![located.part] !== part) return;
    const position = located.position;
    const size = position.fontSizePt * PT;
    // Story text sits on a baseline one type size below the line top; plain text hangs from the top.
    const top = position.y + size * (part.topBaseline ? 0 : 0.15);
    if (top + size < 0 || top > frame.height) return;
    const left = box.x + position.x * box.pxPerMm, y = box.y + top * box.pxPerMm, height = size * 1.12 * box.pxPerMm;
    const key = `${left.toFixed(1)}:${y.toFixed(1)}:${height.toFixed(1)}`;
    this.caretPainted = true;
    this.caret.style.display = 'block';
    this.caret.style.left = `${left - 0.75}px`;
    this.caret.style.top = `${y}px`;
    this.caret.style.height = `${height}px`;
    this.caret.style.backgroundColor = position.color || '#111111';
    if (key !== this.caretKey) {
      // Keep the caret solid while it moves; the blink restarts from its visible phase.
      this.caretKey = key;
      this.caret.style.animation = 'none';
      void this.caret.offsetWidth;
      this.caret.style.animation = '';
    }
  }

  /**
   * After every edited frame was painted. Hides the caret when no frame showed it (a range, no
   * focus, overset text) and reports what the view should follow, once per caret movement.
   */
  public finishPaint(): LiveTextReveal | null {
    if (!this.caretPainted) {
      this.caret.style.display = 'none';
      this.caretKey = '';
    }
    if (!this.reveal) return null;
    this.reveal = false;
    const { start, end } = this.selection;
    if (start !== end || document.activeElement !== this.textarea) return null;
    if (this.caretPainted) return { caret: this.caretBox()! };
    const shown = this.shownEnd();
    return shown !== null && start >= shown ? { beyond: start } : null;
  }

  /** Offset just past the last character the edited frames show, or null when they show no lines. */
  private shownEnd(): number | null {
    let shown: number | null = null;
    for (const part of this.composed?.result.parts || []) for (const line of part.live) shown = Math.max(shown ?? 0, line.next);
    return shown;
  }

  /** Where the caret is drawn, in canvas CSS pixels. For tests and tooling. */
  public caretBox(): { x: number; y: number; height: number } | null {
    if (this.caret.style.display === 'none') return null;
    return { x: parseFloat(this.caret.style.left) + 0.75, y: parseFloat(this.caret.style.top), height: parseFloat(this.caret.style.height) };
  }

  private handleKeyDown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.host.close(false);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      this.host.close(true);
      return;
    }
    const apple = /Mac|iPhone|iPad/.test(navigator.platform);
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    if (event.key === 'Tab' && plain) {
      // In a text frame Tab is a character, as in InDesign, not a move to the next control.
      // Shift+Tab (a right-indent tab there) has no equivalent yet; it must not leave the editor either.
      event.preventDefault();
      if (!event.shiftKey) this.insertText('\t');
      return;
    }
    // By physical key, so the shortcuts work on any keyboard layout.
    const format = ({ KeyB: 'bold', KeyI: 'italic', KeyU: 'underline' } as Record<string, LiveTextFormat>)[event.code];
    if (format && (apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      this.host.format(format);
      return;
    }
    const { selectionStart, selectionEnd } = this.textarea;
    if (plain && !event.shiftKey && selectionStart === selectionEnd) {
      // At either end of the edited frames the story may go on, on another spread.
      const leaving = (event.key === 'ArrowLeft' || event.key === 'Backspace') && selectionStart === 0 ? -1
        : event.key === 'ArrowRight' && selectionStart === this.textarea.value.length && selectionStart === (this.shownEnd() ?? -1) ? 1 : 0;
      if (leaving && this.host.follow(selectionStart, leaving)) {
        event.preventDefault();
        return;
      }
    }
    let handled = false;
    // The textarea wraps its own text differently from the page, so anything line-based is ours.
    if (plain && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      handled = this.moveVertically(event.key === 'ArrowUp' ? -1 : 1, event.shiftKey);
    } else if (plain && (event.key === 'PageUp' || event.key === 'PageDown')) {
      handled = this.moveVertically(event.key === 'PageUp' ? -1 : 1, event.shiftKey, true);
    } else if (plain && (event.key === 'Home' || event.key === 'End')) {
      handled = this.moveToLineEdge(event.key === 'End', event.shiftKey);
    } else if (apple && event.metaKey && !event.ctrlKey && !event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      handled = this.moveToLineEdge(event.key === 'ArrowRight', event.shiftKey);
    }
    if (handled) event.preventDefault();
  }

  /** Type `text` at the selection, as the keyboard would: one input event, on the textarea's own undo stack. */
  private insertText(text: string) {
    // execCommand is deprecated but still the only way to keep the edit undoable with Ctrl+Z.
    if (document.execCommand?.('insertText', false, text)) return;
    this.textarea.setRangeText(text, this.textarea.selectionStart, this.textarea.selectionEnd, 'end');
    this.textarea.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true }));
  }

  private moveVertically(direction: -1 | 1, extend: boolean, page = false): boolean {
    const parts = this.current().parts;
    const located = locateCaret(parts, this.focusOffset, this.affinity);
    // An overset caret has no line to move from; let the textarea handle the key.
    if (!located) return false;
    const length = this.textarea.value.length;
    const from = this.host.box(parts[located.part].frame);
    const goal = this.goalX ?? from.x + located.position.x * from.pxPerMm;
    let target: { part: number; line: number } | null = { part: located.part, line: located.position.line };
    // Page keys travel to the first or last line of the column the caret is in.
    const lines = parts[located.part].live;
    while (page && lines[target.line + direction]?.column === lines[located.position.line].column) target.line += direction;
    if (target.line === located.position.line) target = neighbourLine(parts, located.part, located.position.line, direction);
    // No line further that way here: the story may continue on another spread.
    if (!target && !extend && this.host.follow(direction < 0 ? 0 : this.shownEnd() ?? length, direction)) return true;
    let hit: Hit = { offset: direction < 0 ? 0 : length, affinity: 'start' };
    if (target) {
      const box = this.host.box(parts[target.part].frame);
      hit = lineOffsetAt(parts[target.part].live[target.line], (goal - box.x) / box.pxPerMm);
      if (hit.offset > length) hit = { offset: length, affinity: 'start' };
    }
    this.select(extend ? this.anchorOffset : hit.offset, hit.offset, hit.affinity, true);
    this.goalX = goal;
    return true;
  }

  private moveToLineEdge(end: boolean, extend: boolean): boolean {
    const parts = this.current().parts;
    const located = locateCaret(parts, this.focusOffset, this.affinity);
    if (!located) return false;
    const line = parts[located.part].live[located.position.line];
    const offset = Math.min(end ? line.end : line.start, this.textarea.value.length);
    this.goalX = null;
    this.select(extend ? this.anchorOffset : offset, offset, end && !line.hard ? 'end' : 'start', true);
    return true;
  }

  /** A press on the canvas. Returns false when it missed the edited frames, so the canvas handles it. */
  public pointerDown(canvasX: number, canvasY: number, event: { shiftKey?: boolean; detail?: number }): boolean {
    const hit = this.hit(canvasX, canvasY);
    if (!hit) return false;
    const clicks = event.detail || 1;
    const text = this.textarea.value;
    this.goalX = null;
    if (document.activeElement !== this.textarea) this.textarea.focus({ preventScroll: true });
    if (clicks >= 3) {
      const range = paragraphRangeAt(text, hit.offset);
      this.drag = { mode: 'paragraph', ...range };
      this.select(range.start, range.end);
    } else if (clicks === 2) {
      const range = wordRangeAt(text, hit.offset);
      this.drag = { mode: 'word', ...range };
      this.select(range.start, range.end);
    } else {
      const anchor = event.shiftKey ? this.anchorOffset : hit.offset;
      this.drag = { mode: 'character', start: anchor, end: anchor };
      this.select(anchor, hit.offset, hit.affinity);
    }
    return true;
  }

  /** Pointer movement. Extends a drag selection; reports whether the pointer is over an edited frame. */
  public pointerMove(canvasX: number, canvasY: number, buttons?: number): 'drag' | 'over' | null {
    // The button was released where no mouseup reached us (outside the window): the drag is over.
    if (buttons === 0) this.drag = null;
    if (this.drag) {
      const hit = this.hit(canvasX, canvasY, true);
      if (hit) {
        const text = this.textarea.value;
        const range = this.drag.mode === 'word' ? wordRangeAt(text, hit.offset)
          : this.drag.mode === 'paragraph' ? paragraphRangeAt(text, hit.offset) : { start: hit.offset, end: hit.offset };
        // Dragging backwards keeps the far end of the word or paragraph the drag began on.
        if (range.start < this.drag.start) this.select(this.drag.end, range.start);
        else this.select(this.drag.start, Math.max(range.end, this.drag.end), this.drag.mode === 'character' ? hit.affinity : 'start');
      }
      return 'drag';
    }
    return this.partAt(canvasX, canvasY, false) ? 'over' : null;
  }

  public pointerUp(): boolean {
    if (!this.drag) return false;
    this.drag = null;
    return true;
  }

  /** Follow text changes made elsewhere (inspector, reflow, collaborators) while nothing is pending here. */
  public syncWithState() {
    // The frames, their styles or their neighbours may have changed: compose afresh for the next input.
    this.composed = null;
    const current = this.host.base()?.text;
    if (current === undefined || current === this.committedText) return;
    if (this.textarea.value === this.committedText) {
      const { selectionStart, selectionEnd, selectionDirection } = this.textarea;
      this.textarea.value = current;
      this.textarea.setSelectionRange(Math.min(selectionStart, current.length), Math.min(selectionEnd, current.length), selectionDirection || 'none');
      this.known = { start: this.textarea.selectionStart, end: this.textarea.selectionEnd };
      this.edits = [];
    } else {
      // Pending typing meets a text change from elsewhere: keep the typing as one edit over the new text.
      this.edits = [textEdit(current, this.textarea.value)];
    }
    this.committedText = current;
    this.lastValue = this.textarea.value;
    this.draft = null;
  }

  public destroy() {
    this.closed = true;
    this.lifetime.abort();
    this.textarea.remove();
    this.caret.remove();
  }
}
