import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Vault } from '../src/core/vault';

let dir: string;
let v: Vault;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'lr-doc-'));
  v = await Vault.create(path.join(dir, 'Scholarship'), { name: 'Scholarship', pack: 'scholarship', author: 't' });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function entry(title: string, body: string) {
  const e = await v.createEntry({ title });
  await v.saveEntry(e.id, body);
  return e.id;
}

describe('links between documents and live quotations', () => {
  it('links [[Document]] and lists it under Linked from; renaming keeps the link', async () => {
    const pope = await entry('The Papacy', 'Notes on the office of the Pope.');
    const sermon = await entry('Sermon on Peter', 'See [[The Papacy]] for the history.');
    const b = [...v.blocks.values()].find((x) => x.owner.id === sermon)!;
    expect(b.docLinks).toEqual([pope]);
    expect(b.warnings).toEqual([]);
    expect(v.documentBacklinks(pope).map((l) => l.source.title)).toEqual(['Sermon on Peter']);
    await v.updateEntry(pope, { title: 'Papacy research' });
    expect(v.getEntry(sermon).body).toContain('[[Papacy research]]');
    expect(v.documentBacklinks(pope)).toHaveLength(1);
  });

  it('quotes a page, a document or a paragraph live, and files the quote where asked', async () => {
    await v.createEntity({ name: 'First Vatican Council', type: 'council' });
    await v.createEntity({ name: 'Pope Pius IX', type: 'person' });
    const notes = await entry('Council notes', 'The council defined papal infallibility in July 1870. !key');
    const para = [...v.blocks.values()].find((x) => x.owner.id === notes)!;
    const pope = await entry('The Papacy', 'Notes.');
    await v.appendToEntry(pope, `![[#${para.id}]] @Pope Pius IX`);
    await v.appendToEntry(pope, '![[First Vatican Council]]');
    const blocks = [...v.blocks.values()].filter((x) => x.owner.id === pope).sort((a, b) => a.position - b.position);
    expect(blocks[1].embeds).toEqual([{ kind: 'block', id: para.id }]);
    expect(blocks[1].filedTo.map((f) => v.entities.get(f.entityId)!.name)).toEqual(['Pope Pius IX']);
    expect(blocks[2].embeds?.[0].kind).toBe('entity');
    expect(v.embedPreview(`#${para.id}`)).toMatchObject({ kind: 'block', source: { title: 'Council notes' } });
    const card = v.embedPreview('First Vatican Council');
    expect(card).toMatchObject({ kind: 'entity', title: 'First Vatican Council' });
    expect(v.embedPreview('Council notes')).toMatchObject({ kind: 'document', title: 'Council notes' });
    // Quoting one of its paragraphs lists the source document under Linked from.
    expect(v.documentBacklinks(notes).map((l) => [l.source.title, l.quoted])).toEqual([['The Papacy', true]]);
  });
});
