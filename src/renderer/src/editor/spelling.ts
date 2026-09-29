// Spell checking (the system / browser checker draws the red underlines) and
// autocorrect as you type. One Ctrl+Z after a correction puts your word back.
import { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import type { Extension } from '@codemirror/state';
import { correctionFor, DEFAULT_AUTOCORRECT, NAME_STOPWORDS, type AutocorrectPrefs } from '../../../core/autocorrect';
import { envField } from './extensions';

let prefs: AutocorrectPrefs = DEFAULT_AUTOCORRECT;
let spellcheck = true;

export function setSpellingPrefs(p: { autocorrect: AutocorrectPrefs; spellcheck: boolean }) {
  prefs = p.autocorrect;
  spellcheck = p.spellcheck;
  for (const el of document.querySelectorAll('.cm-content')) el.setAttribute('spellcheck', String(spellcheck));
}

const BOUNDARY = /^[\s.,;:!?)\]"'”’]$/;

const autocorrect = EditorView.inputHandler.of((view, from, to, text) => {
  if (!prefs.enabled || !BOUNDARY.test(text) || from !== to) return false;
  const env = view.state.field(envField, false);
  const line = view.state.doc.lineAt(from);
  const before = view.state.sliceDoc(line.from, from);
  const isName = (w: string) => {
    if (!env) return false;
    const lw = w.toLowerCase();
    if (NAME_STOPWORDS.has(lw)) return false;
    for (const e of env.entities.values()) {
      for (const n of [e.name, ...e.aliases]) if (n.toLowerCase().split(/[\s-]+/).includes(lw)) return true;
    }
    return false;
  };
  const c = correctionFor(before, line.from, prefs, isName);
  if (!c) return false;
  // Type the character normally, then apply the fix as its own undo step:
  // like Word, Ctrl+Z puts your word back and keeps the space you typed.
  view.dispatch({ changes: { from, insert: text }, selection: { anchor: from + text.length }, userEvent: 'input.type' });
  view.dispatch({
    changes: { from: c.from, to: c.to, insert: c.insert },
    userEvent: 'input.autocorrect',
    annotations: isolateHistory.of('full'),
  });
  return true;
});

export function spellingExtensions(): Extension[] {
  return [
    EditorView.contentAttributes.of(() => ({ spellcheck: String(spellcheck), autocorrect: 'off', autocapitalize: 'off' })),
    autocorrect,
  ];
}
