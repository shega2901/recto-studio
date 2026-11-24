import Hypher from 'hypher';
import english from 'hyphenation.en-us';
import german from 'hyphenation.de';
import french from 'hyphenation.fr';
import type { HypherLanguage } from './hyphenation/texPatterns';

const dictionaries = new Map([
  ['en-US', new Hypher(english)], ['de', new Hypher(german)], ['fr', new Hypher(french)],
]);

/**
 * Dictionaries that load on demand, outside the startup bundle. The composer runs synchronously, so
 * until one has loaded its words are not hyphenated; listeners are told when it arrives so the
 * stories using it can be composed again.
 */
const lazyDictionaries: Record<string, () => Promise<{ default: HypherLanguage }>> = {
  ru: () => import('./hyphenation/ru'),
};
const loading = new Map<string, Promise<boolean>>();
const listeners = new Set<(language: string) => void>();
let generation = 0;

/** Changes whenever a dictionary arrives, so layouts cached before it can be told apart. */
export function hyphenationGeneration(): number {
  return generation;
}

export function onHyphenationLoaded(listener: (language: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Load the dictionary for `language` if it is one that loads on demand. Resolves to whether it is available. */
export function loadHyphenation(language: string): Promise<boolean> {
  if (dictionaries.has(language)) return Promise.resolve(true);
  const load = lazyDictionaries[language];
  if (!load) return Promise.resolve(false);
  let pending = loading.get(language);
  if (!pending) {
    pending = load().then(module => {
      dictionaries.set(language, new Hypher(module.default));
      generation++;
      for (const listener of listeners) listener(language);
      return true;
    }, error => {
      // Let a later call try again (the file may have been unreachable offline).
      loading.delete(language);
      console.warn(`The ${language} hyphenation dictionary could not be loaded.`, error);
      return false;
    });
    loading.set(language, pending);
  }
  return pending;
}

export function hyphenateLanguage(word: string, language = 'en-US'): string[] {
  if (!/^\p{L}+$/u.test(word)) return [word];
  const dictionary = dictionaries.get(language);
  if (!dictionary) {
    if (lazyDictionaries[language]) void loadHyphenation(language);
    return [word];
  }
  return dictionary.hyphenate(word);
}
