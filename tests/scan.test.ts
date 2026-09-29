import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Vault } from '../src/core/vault';
import { compileWords, findWords, majorScore } from '../src/core/triggers';

let dir: string;
let v: Vault;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'lr-scan-'));
  v = await Vault.create(path.join(dir, 'Scholarship'), { name: 'Scholarship', pack: 'scholarship', author: 't' });
  await v.createEntity({ name: 'Apple Scouch', type: 'church-father', aliases: ['the Vine Doctor'] });
  await v.createEntity({ name: 'John Chrysostom', type: 'church-father' });
  await v.createEntity({ name: 'John of Damascus', type: 'church-father' });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function entry(body: string) {
  const e = await v.createEntry({ title: 'Notes' });
  await v.saveEntry(e.id, body);
  return e.id;
}
const kinds = (list: Array<{ kind: string }>) => list.map((s) => s.kind).sort();

describe('trigger words', () => {
  it('matches words, phrases and stems', () => {
    const re = compileWords(['baptiz*', 'the lord\'s supper', 'canon'])!;
    expect(findWords(re, 'He baptized them; the Lord’s supper; canonical? canon.').map((h) => h.word)).toEqual(['baptized', 'the Lord’s supper', 'canon']);
  });

  it('scores major statements', () => {
    expect(majorScore('We confess one God, and let him be anathema who denies it.').score).toBeGreaterThanOrEqual(3);
    expect(majorScore('He walked to the market in the morning.').score).toBe(0);
  });
});

describe('active scan', () => {
  it('finds untagged names, ambiguous names, themes and major statements', async () => {
    const id = await entry(
      [
        'Scouch argued this at length, and the Vine Doctor repeated it.',
        'John wrote on it as well.',
        'The Shepherd of Hermas was read in the churches but not received as canonical by all.',
        'We confess that the Son is of one substance with the Father.',
      ].join('\n\n'),
    );
    const { suggestions } = v.scan({ doc: { kind: 'entry', id } });
    const mention = suggestions.find((s) => s.kind === 'mention')!;
    expect(mention.match).toBe('Scouch');
    expect(mention.count).toBe(2); // "Scouch" and the alias both point at one page
    expect(suggestions.find((s) => s.kind === 'ambiguous')!.entityIds).toHaveLength(2);
    const canon = suggestions.find((s) => s.themeId === 'canon')!;
    expect(canon.create).toBe('Canon of Scripture');
    expect(suggestions.some((s) => s.kind === 'major')).toBe(true);
  });

  it('accepting a name turns it into a chip in place; dismissals are remembered', async () => {
    const id = await entry('Scouch argued this at length.\n\nJohn wrote on it as well.');
    let list = v.scan({ doc: { kind: 'entry', id } }).suggestions;
    await v.acceptSuggestion(list.find((s) => s.kind === 'mention')!.id);
    const body = v.getEntry(id).body;
    expect(body).toMatch(/^@Scouch argued/);
    const b = [...v.blocks.values()].find((x) => x.text.startsWith('@Scouch'))!;
    expect(b.filedTo.map((f) => v.entities.get(f.entityId)!.name)).toEqual(['Apple Scouch']);

    const amb = v.scan({ doc: { kind: 'entry', id } }).suggestions.find((s) => s.kind === 'ambiguous')!;
    await expect(v.acceptSuggestion(amb.id)).rejects.toThrow(/Choose/);
    const damascene = [...v.entities.values()].find((e) => e.name === 'John of Damascus')!;
    await v.acceptSuggestion(amb.id, { entityId: damascene.id });
    expect(v.getEntry(id).body).toContain('@[John of Damascus|John] wrote');

    await v.createEntity({ name: 'Grace', type: 'topic' });
    await v.updateEntity([...v.entities.values()].find((e) => e.name === 'Grace')!.id, { keywords: ['synergy'] });
    const id2 = await entry('On synergy and cooperation.');
    list = v.scan({ doc: { kind: 'entry', id: id2 } }).suggestions;
    const kw = list.find((s) => s.kind === 'keyword')!;
    await v.dismissSuggestion(kw.id);
    expect(v.scan({ doc: { kind: 'entry', id: id2 } }).suggestions.some((s) => s.kind === 'keyword')).toBe(false);
    const v2 = await Vault.open(v.root, { author: 't' });
    expect(v2.scan({ doc: { kind: 'entry', id: id2 } }).suggestions.some((s) => s.kind === 'keyword')).toBe(false);
  });

  it('files imported paragraphs by adding the tag at the end and creates theme pages', async () => {
    const r = await v.importLibrary({
      title: 'Church History',
      text: 'Book III\n\nAmong the disputed books, which are nevertheless recognised by many, are the epistle called James and that of Jude. The Shepherd of Hermas is to be placed among the spurious.\n\nOrigen and Scouch agreed.',
      kind: 'text',
    });
    const { suggestions } = v.scan({ doc: { kind: 'library', id: r.ids[0] } });
    expect(kinds(suggestions)).toEqual(expect.arrayContaining(['mention', 'theme']));
    const theme = suggestions.find((s) => s.themeId === 'canon')!;
    const res = await v.acceptSuggestion(theme.id, { section: 'Sources' });
    expect(res.createdPage?.name).toBe('Canon of Scripture');
    const b = v.blocks.get(theme.blockId)!;
    expect(b.text).toMatch(/The Shepherd of Hermas is to be placed among the spurious\. @\[?Canon of Scripture\]?::Sources$/);
    expect(b.filedTo[0]).toMatchObject({ entityId: res.createdPage!.id, section: 'Sources' });
  });

  it('suggests new names used more than once and a Scripture book with its own page', async () => {
    await v.createEntity({ name: 'Romans', type: 'topic' });
    const id = await entry('Later, Tertullian answered. Nobody read Tertullian kindly.\n\nPaul says in Rom 3:23 that all have sinned.');
    const { suggestions } = v.scan({ doc: { kind: 'entry', id } });
    const nn = suggestions.find((s) => s.kind === 'new-name')!;
    expect(nn).toMatchObject({ create: 'Tertullian', count: 2 });
    expect(suggestions.find((s) => s.kind === 'scripture')!.match).toBe('Romans 3:23');
    await v.acceptSuggestion(nn.id, { type: 'church-father' });
    expect([...v.entities.values()].find((e) => e.name === 'Tertullian')?.type).toBe('church-father');
    expect(v.getEntry(id).body).toContain('@Tertullian answered');
  });

  it('trigger themes can be edited and saved', async () => {
    const themes = v.getTriggers();
    expect(themes.length).toBeGreaterThan(20);
    await v.saveTriggers([...themes, { id: '', label: 'Vine imagery', words: ['vine', 'branches', 'vinedresser'] }]);
    const v2 = await Vault.open(v.root, { author: 't' });
    expect(v2.getTriggers().find((t) => t.label === 'Vine imagery')).toMatchObject({ id: 'vine-imagery', words: ['vine', 'branches', 'vinedresser'] });
  });
});
