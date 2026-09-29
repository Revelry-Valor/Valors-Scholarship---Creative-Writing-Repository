// "Quote into…": put a live quotation of a paragraph or a page into one of your documents,
// and optionally file it to a page too (so it shows on, say, the Pope's page as well).
import { api } from '../api';
import type { useApp } from '../state';
import type { useDialogs } from './Dialogs';
import { formatTag } from '../../../core/markup';

type App = ReturnType<typeof useApp>;
type Dialogs = ReturnType<typeof useDialogs>;

/** `target` is a paragraph ("#b-…") or a page or document name. */
export async function quoteInto(app: App, dialogs: Dialogs, target: string, what: string) {
  const docs = [...app.nameData.documents].sort((a, b) => a.title.localeCompare(b.title));
  const docId = await dialogs.pick<string>({
    title: `Quote ${what} into…`,
    placeholder: 'Which document?',
    items: [{ label: '+ A new document…', value: '__new' }, ...docs.map((d) => ({ label: `📄 ${d.title}`, value: d.id }))],
  });
  if (!docId) return;
  let id = docId;
  let title = docs.find((d) => d.id === docId)?.title ?? '';
  if (docId === '__new') {
    const t = await dialogs.prompt({ title: 'New document', label: 'Title', okLabel: 'Create' });
    if (!t) return;
    const e = await api.createEntry({ title: t });
    id = e.id;
    title = t;
  }
  const also = await dialogs.pick<string>({
    title: 'Also file it to a page?',
    placeholder: 'Optional',
    items: [{ label: 'No, just the document', value: '' }, ...[...app.nameData.entities].sort((a, b) => a.name.localeCompare(b.name)).map((e) => ({ label: e.name, detail: e.typeName, value: e.id, color: e.color }))],
  });
  if (also === null) return;
  const page = also ? app.entityById.get(also) : undefined;
  const paragraph = `![[${target}]]${page ? ` ${formatTag(page.name)}` : ''}`;
  try {
    await api.appendToEntry(id, paragraph);
    app.notify(`Quoted into “${title}”${page ? ` and filed to ${page.name}` : ''}`);
  } catch (err) {
    app.notify((err as Error).message, 'error');
  }
}
