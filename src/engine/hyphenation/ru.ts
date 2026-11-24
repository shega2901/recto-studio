/**
 * Russian hyphenation, loaded on demand. The data is the unmodified hyph-ru.tex from hyph-utf8
 * (Alexander I. Lebedev, LPPL 1.2 or later); see public/licenses/hyphenation/NOTICE.md, where the
 * same file is published with its licence. A test keeps the two copies identical.
 */
import source from './hyph-ru.tex?raw';
import { parseTexPatterns } from './texPatterns';

// The file's hyphenmins: at least two letters stay on each side of a break.
export default parseTexPatterns(source, { id: 'ru', leftmin: 2, rightmin: 2 });
