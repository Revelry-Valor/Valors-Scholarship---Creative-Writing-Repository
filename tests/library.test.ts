import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Vault } from '../src/core/vault';
import { searchBlocks } from '../src/core/views';

let dir: string;
let v: Vault;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'lr-lib-'));
  v = await Vault.create(path.join(dir, 'Scholarship'), { name: 'Scholarship', pack: 'scholarship', author: 't' });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const bible = ['Genesis 1:1 In the beginning God created the heaven and the earth.', 'Genesis 1:2 And the earth was without form.', 'Genesis 1:3 And God said, Let there be light.', 'John 1:1 In the beginning was the Word.', 'John 3:16 For God so loved the world.'].join('\n');

describe('library', () => {
  it('imports a Bible by book, addresses every verse, and survives a reopen', async () => {
    const r = await v.importLibrary({ title: 'King James Version', text: bible, translation: 'KJV' });
    expect(r).toMatchObject({ kind: 'bible', paragraphs: 5, collection: 'KJV' });
    expect(v.listLibrary().map((l) => l.title)).toEqual(['Genesis (KJV)', 'John (KJV)']);
    const john = v.listLibrary()[1];
    const doc = v.getLibraryDoc(john.id);
    const verse = doc.blocks.find((b) => b.text.includes('so loved'))!;
    const rec = v.blocks.get(verse.id)!;
    expect(rec.owner.kind).toBe('library');
    expect(rec.scripture[0].label).toBe('John 3:16');
    // Library paragraphs are searchable and keep no authorship history.
    expect(searchBlocks(v, 'so loved')[0].block.source.title).toBe('John (KJV)');
    expect(v.meta.get(verse.id)).toBeUndefined();
    const v2 = await Vault.open(v.root, { author: 't' });
    expect(v2.listLibrary()).toHaveLength(2);
    expect(v2.blocks.get(verse.id)?.text).toContain('so loved');
  });

  it('imports a Father\'s work with a Work page and author', async () => {
    await v.createEntity({ name: 'Irenaeus', type: 'church-father' });
    const r = await v.importLibrary({ title: 'Against Heresies', text: 'Book I\n\nThe Church, though dispersed through the whole world, has received this faith.\n\nPaul says in Rom 8:28 that all things work together.', author: 'Irenaeus', makePage: true });
    expect(r.kind).toBe('text');
    const page = v.entities.get(r.page!)!;
    expect(page).toMatchObject({ name: 'Against Heresies', type: 'work' });
    expect(page.fields.author).toBe('@Irenaeus');
    const rec = v.listLibrary()[0];
    expect(rec).toMatchObject({ title: 'Against Heresies', kind: 'text', author: 'Irenaeus', page: r.page });
    const refs = [...v.blocks.values()].filter((b) => b.owner.kind === 'library').flatMap((b) => b.scripture.map((s) => s.label));
    expect(refs).toEqual(['Romans 8:28']);
  });
});
