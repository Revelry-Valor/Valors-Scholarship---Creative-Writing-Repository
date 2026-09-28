// Hover over a Greek or Hebrew word (or a Strong's number) to see what your lexicons say.
import { hoverTooltip, type Tooltip } from '@codemirror/view';
import { api } from '../api';
import { lexicalWords } from '../../../core/lexicon';

const cache = new Map<string, Promise<Awaited<ReturnType<typeof api.lexiconLookup>>>>();
let hasLexicons: boolean | null = null;
let checkedAt = 0;

/** Forget cached lookups (after importing or deleting a lexicon). */
export function resetLexiconCache() {
  cache.clear();
  hasLexicons = null;
}

async function anyLexicon(): Promise<boolean> {
  if (hasLexicons === null || Date.now() - checkedAt > 30_000) {
    checkedAt = Date.now();
    hasLexicons = (await api.listLexicons().catch(() => [])).length > 0;
  }
  return hasLexicons;
}

export const lexiconHover = hoverTooltip(
  async (view, pos): Promise<Tooltip | null> => {
    const line = view.state.doc.lineAt(pos);
    const word = lexicalWords(line.text).find((w) => line.from + w.from <= pos && pos <= line.from + w.to);
    if (!word || !(await anyLexicon())) return null;
    let p = cache.get(word.word);
    if (!p) {
      p = api.lexiconLookup(word.word, { limit: 3, english: false }).catch(() => []);
      cache.set(word.word, p);
    }
    const hits = await p;
    if (!hits.length) return null;
    return {
      pos: line.from + word.from,
      end: line.from + word.to,
      above: true,
      create() {
        const dom = document.createElement('div');
        dom.className = 'lex-tip';
        for (const h of hits) {
          const row = document.createElement('div');
          row.className = 'lex-tip-row';
          const head = document.createElement('div');
          head.className = 'lex-tip-head';
          const lemma = document.createElement('span');
          lemma.className = 'lex-lemma';
          lemma.textContent = h.lemma;
          head.append(lemma);
          const meta = [h.translit, h.strong, h.morph].filter(Boolean).join(' · ');
          if (meta) {
            const m = document.createElement('span');
            m.className = 'lex-meta';
            m.textContent = meta;
            head.append(m);
          }
          row.append(head);
          const text = h.gloss && h.def ? `${h.gloss} — ${h.def}` : h.gloss ?? h.def ?? '';
          const def = document.createElement('div');
          def.className = 'lex-def';
          def.textContent = text.length > 320 ? `${text.slice(0, 318)}…` : text;
          row.append(def);
          const src = document.createElement('div');
          src.className = 'lex-src';
          src.textContent = h.lexiconName;
          row.append(src);
          dom.append(row);
        }
        return { dom };
      },
    };
  },
  { hoverTime: 350 },
);
