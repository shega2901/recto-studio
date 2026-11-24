# Hyphenation components

Hypher by Bram Stein is distributed under the BSD 3-Clause license in
HYPHER-BSD.txt. Source: https://github.com/bramstein/hypher

The unmodified English (US), German and French pattern modules are provided here
as en-us.js, de.js and fr.js. They are third-party language data, not original
Recto code. The upstream distribution states that patterns are licensed under
the LGPL unless otherwise noted, with copyright held by their respective creators
and maintainers. Its notice is preserved in UPSTREAM.md and LGPL-2.1.txt.
Source: https://github.com/bramstein/hyphenation-patterns

The Russian patterns are provided as hyph-ru.tex, the unmodified file from the
hyph-utf8 package (https://github.com/hyphenation/tex-hyphen, commit
5684c0f51c0b81133db2efbe60a408b4155a3ff5). Copyright (C) 1999-2003 Alexander I.
Lebedev, distributed under the LaTeX Project Public License, version 1.2 or later
(LPPL-1.3c.txt). Recto bundles an identical copy (src/engine/hyphenation/hyph-ru.tex)
and reads it as it is when Russian hyphenation is first needed; it does not ship a
converted copy.

The application's npm lockfile identifies the exact dictionary and engine versions.
