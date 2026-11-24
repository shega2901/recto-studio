/**
 * Reads a TeX hyphenation pattern file (the hyph-utf8 format) into the language object Hypher takes.
 *
 * Dictionaries are shipped as their unmodified upstream files and converted when they are loaded,
 * so the distributed file is the licensed original rather than a derived copy.
 */
export interface HypherLanguage {
  id: string;
  leftmin: number;
  rightmin: number;
  /** Patterns grouped by length, each group concatenated, as Hypher expects. */
  patterns: Record<number, string>;
  /** Comma-separated exception words with U+2027 at their break points. */
  exceptions?: string;
}

function block(source: string, command: 'patterns' | 'hyphenation'): string[] {
  const start = source.indexOf(`\\${command}{`);
  if (start === -1) return [];
  const end = source.indexOf('}', start);
  if (end === -1) throw new Error(`Unterminated \\${command} block in hyphenation patterns.`);
  return source.slice(start + command.length + 2, end).split(/\s+/).filter(Boolean);
}

export function parseTexPatterns(source: string, options: { id: string; leftmin: number; rightmin: number }): HypherLanguage {
  // TeX comments run from % to the end of the line.
  const text = source.split('\n').map(line => line.replace(/%.*$/, '')).join('\n');
  const groups = new Map<number, string[]>();
  for (const pattern of block(text, 'patterns')) {
    // TeX marks a word boundary with ".", Hypher with "_".
    const converted = pattern.replace(/\./g, '_');
    const group = groups.get(converted.length) ?? [];
    group.push(converted);
    groups.set(converted.length, group);
  }
  if (!groups.size) throw new Error('No hyphenation patterns found.');
  const patterns: Record<number, string> = {};
  for (const [length, group] of groups) patterns[length] = group.join('');
  const exceptions = block(text, 'hyphenation').map(word => word.replace(/-/g, '‧'));
  return { ...options, patterns, ...(exceptions.length ? { exceptions: exceptions.join(', ') } : {}) };
}
