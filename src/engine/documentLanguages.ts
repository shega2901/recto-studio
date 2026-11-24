import type { ProjectState, StoryParagraph } from '../types';
import { formattedStoryHeadsMatching } from './storyContent';
import { resolveParagraphStyle } from './storyLayout';

function hyphenatesIn(state: Pick<ProjectState, 'paragraphStyles'>, paragraph: StoryParagraph, language?: string) {
  const style = resolveParagraphStyle(paragraph, state.paragraphStyles);
  return style.hyphenate && style.language && (!language || style.language === language) ? style.language : undefined;
}

/** Hyphenation languages the document's paragraphs and paragraph styles ask for. */
export function documentHyphenationLanguages(state: Pick<ProjectState, 'paragraphStyles' | 'spreads'>): Set<string> {
  const languages = new Set<string>();
  for (const style of state.paragraphStyles) if (style.hyphenate && style.language) languages.add(style.language);
  formattedStoryHeadsMatching(state, content => {
    for (const paragraph of content.paragraphs) {
      const language = hyphenatesIn(state, paragraph);
      if (language) languages.add(language);
    }
    return false;
  }, () => false);
  return languages;
}

/** Formatted stories with a paragraph hyphenated in `language`: a newly loaded dictionary changes their breaks. */
export function storyHeadsHyphenatedIn(state: Pick<ProjectState, 'paragraphStyles' | 'spreads'>, language: string) {
  return formattedStoryHeadsMatching(state,
    content => content.paragraphs.some(paragraph => !!hyphenatesIn(state, paragraph, language)), () => false);
}
