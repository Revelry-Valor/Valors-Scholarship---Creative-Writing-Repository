// Phase 1 acceptance tests from spec section 14.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Vault } from '../src/core/vault';
import { buildProfile, keyDetails, quickSwitch, searchBlocks } from '../src/core/views';
import { splitBlocks } from '../src/core/document';
import { factPickerFields } from '../src/core/editing';

let dir: string;
let v: Vault;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'lr-'));
  v = await Vault.create(path.join(dir, 'Scholarship'), { name: 'Scholarship', pack: 'scholarship', author: 'tester' });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const blockWith = (text: string) => [...v.blocks.values()].find((b) => b.text.includes(text))!;
const sectionOf = (entityId: string, blockId: string) => {
  const p = buildProfile(v, entityId);
  for (const s of p.sections) if (s.blocks.some((b) => b.id === blockId)) return s.name;
  if (p.mentions.some((b) => b.id === blockId)) return 'Mentions';
  return null;
};
const onProfile = (entityId: string, blockId: string) => sectionOf(entityId, blockId) !== null;

async function scouchAndPineapple() {
  const s = await v.createEntity({ name: 'Apple Scouch', type: 'church-father' });
  const p = await v.createEntity({ name: 'Chamberlain Pineapple', type: 'church-father' });
  return { s: s.id, p: p.id };
}

describe('Phase 1 acceptance', () => {
  it('T1: @@Name creates a profile in entities/people and files the block under Mentions', async () => {
    const entry = await v.createEntry({ title: 'Early Church Fathers — overview' });
    // The type picker creates the entity first (as the editor does), then the entry is saved.
    const chip = await v.createEntity({ name: 'Apple Scouch', type: 'church-father' });
    await v.saveEntry(entry.id, '@@Apple Scouch wrote a treatise arguing that grace precedes repentance.\n');
    const files = await readdir(path.join(v.root, 'entities', 'people'));
    expect(files).toContain('Apple Scouch.md');
    const b = blockWith('wrote a treatise');
    expect(b.filedTo.map((f) => f.entityId)).toEqual([chip.id]);
    expect(sectionOf(chip.id, b.id)).toBe('Mentions');
  });

  it('T1b: a raw @@Name typed without the picker is created with the last-used type', async () => {
    const entry = await v.createEntry({ title: 'Quick' });
    const res = await v.saveEntry(entry.id, '@@Tertullian of Carthage argued fiercely.\n');
    expect(res.created.map((c) => c.name)).toEqual(['Tertullian of Carthage']);
    const e = [...v.entities.values()].find((x) => x.name === 'Tertullian of Carthage')!;
    expect(e.type).toBe('church-father');
    expect(blockWith('argued fiercely').filedTo[0].entityId).toBe(e.id);
  });

  it('T6: a relationship is stored once and shown from both sides with the same block', async () => {
    const { s, p } = await scouchAndPineapple();
    const entry = await v.createEntry({ title: 'Debate' });
    await v.saveEntry(entry.id, '@Pineapple >disagrees_with> @Scouch on the order of grace and repentance.\n');
    const b = blockWith('order of grace');
    expect(b.relations).toHaveLength(1);
    const all = [...v.blocks.values()].flatMap((x) => x.relations);
    expect(all).toHaveLength(1);
    const pp = buildProfile(v, p);
    const sp = buildProfile(v, s);
    expect(pp.relations.map((g) => g.label)).toEqual(['Disagrees with']);
    expect(pp.relations[0].items[0].other.name).toBe('Apple Scouch');
    expect(sp.relations.map((g) => g.label)).toEqual(['Disagreed with by']);
    expect(sp.relations[0].items[0].other.name).toBe('Chamberlain Pineapple');
    expect(pp.relations[0].items[0].block.id).toBe(b.id);
    expect(sp.relations[0].items[0].block.id).toBe(b.id);
    // Conflict relations go to the Disagreements section by template rule.
    expect(sectionOf(p, b.id)).toBe('Disagreements');
    expect(sectionOf(s, b.id)).toBe('Disagreements');
  });

  it('T7: editing a block from a profile changes it everywhere and keeps history', async () => {
    const { s, p } = await scouchAndPineapple();
    const entry = await v.createEntry({ title: 'Overview' });
    await v.saveEntry(entry.id, '@Pineapple >disagrees_with> @Scouch on grace and repentence.\n');
    const b = blockWith('repentence');
    await v.updateBlock(b.id, '@Pineapple >disagrees_with> @Scouch on grace and repentance.');
    const onDisk = await readFile(path.join(v.root, v.entries.get(entry.id)!.file), 'utf8');
    expect(onDisk).toContain(`repentance. ^${b.id}`);
    expect(onDisk).not.toContain('repentence');
    const view = buildProfile(v, p).sections.flatMap((x) => x.blocks).find((x) => x.id === b.id)!;
    expect(view.text).toContain('repentance.');
    expect(buildProfile(v, s).sections.flatMap((x) => x.blocks).find((x) => x.id === b.id)!.text).toContain('repentance.');
    const hist = v.blockHistory(b.id)!;
    expect(hist.history.map((h) => h.text)).toEqual([
      '@Pineapple >disagrees_with> @Scouch on grace and repentence.',
      '@Pineapple >disagrees_with> @Scouch on grace and repentance.',
    ]);
  });

  it('T8: deleting a shared block reports every page it appears on', async () => {
    await scouchAndPineapple();
    const entry = await v.createEntry({ title: 'Overview' });
    await v.saveEntry(entry.id, '@Pineapple >disagrees_with> @Scouch here.\n');
    const b = blockWith('here.');
    const pages = v.blockPages(b.id);
    expect(pages).toHaveLength(3);
    expect(pages.map((p) => p.title)).toEqual(['Overview', 'Chamberlain Pineapple', 'Apple Scouch']);
    // "Delete everywhere"
    await v.deleteBlock(b.id);
    expect(v.blocks.has(b.id)).toBe(false);
    expect(v.meta.get(b.id)!.status).toBe('deleted');
  });

  it('T8b: "remove tag for this page" takes a block off one profile only', async () => {
    const { s, p } = await scouchAndPineapple();
    const entry = await v.createEntry({ title: 'Overview' });
    await v.saveEntry(entry.id, '## Apple Scouch @\n\n@Pineapple met him once.\n');
    const b = blockWith('met him once');
    expect(onProfile(s, b.id)).toBe(true);
    await v.removeTag(b.id, s); // filed via the section heading → opt-out
    expect(onProfile(s, b.id)).toBe(false);
    expect(onProfile(p, b.id)).toBe(true);
    await v.removeTag(b.id, p); // inline tag → turned into plain text
    expect(onProfile(p, b.id)).toBe(false);
    expect(v.getBlock(b.id).text).toContain('Pineapple met him once.');
  });

  it('T9: a section heading tags every block under it until the next ## heading', async () => {
    const { s } = await scouchAndPineapple();
    const entry = await v.createEntry({ title: 'Overview' });
    await v.saveEntry(entry.id, '## Apple Scouch @Apple Scouch\n\nOne.\n\nTwo.\n\nThree.\n\n## Something else\n\nFour.\n');
    for (const t of ['One.', 'Two.', 'Three.']) expect(onProfile(s, blockWith(t).id)).toBe(true);
    expect(onProfile(s, blockWith('Four.').id)).toBe(false);
  });

  it('T14: renaming rewrites every tag in every file and keeps the old name as alias', async () => {
    const { s } = await scouchAndPineapple();
    const a = await v.createEntry({ title: 'A' });
    const b = await v.createEntry({ title: 'B' });
    await v.saveEntry(a.id, '@Apple Scouch wrote. @Scouch|He agreed.\n\n## Apple Scouch @\n\nUnder heading.\n');
    await v.saveEntry(b.id, '[[Apple Scouch]] is cited. {Apple Scouch.born: 1280}\n');
    await v.renameEntity(s, 'Apple Scouche');
    const fa = await readFile(path.join(v.root, v.entries.get(a.id)!.file), 'utf8');
    const fb = await readFile(path.join(v.root, v.entries.get(b.id)!.file), 'utf8');
    expect(fa).toContain('@Apple Scouche wrote.');
    expect(fa).toContain('@Apple Scouche|He agreed.');
    expect(fa).toContain('## Apple Scouche @');
    expect(fb).toContain('[[Apple Scouche]]');
    expect(fb).toContain('{Apple Scouche.born: 1280}');
    const e = v.entities.get(s)!;
    expect(e.name).toBe('Apple Scouche');
    expect(e.aliases).toContain('Apple Scouch');
    expect(e.file).toBe('entities/people/Apple Scouche.md');
    expect(onProfile(s, blockWith('Under heading').id)).toBe(true);
    expect(buildProfile(v, s).facts.find((f) => f.key === 'born')!.values[0].text).toBe('1280');
  });

  it('T19: deleting .index and reopening gives identical profiles', async () => {
    const { s, p } = await scouchAndPineapple();
    const entry = await v.createEntry({ title: 'Overview' });
    await v.saveEntry(entry.id, '## Apple Scouch @\n\nTaught in the north. {born: 1280}\n\n@Pineapple >disagrees_with> @Scouch sharply.\n');
    const before = JSON.stringify([buildProfile(v, s), buildProfile(v, p)]);
    await rm(path.join(v.root, '.index'), { recursive: true, force: true });
    const v2 = await Vault.open(v.root, { author: 'tester' });
    const after = JSON.stringify([buildProfile(v2, s), buildProfile(v2, p)]);
    expect(after).toBe(before);
  });

  it('T20: an entry edited in another editor is re-indexed', async () => {
    const { s } = await scouchAndPineapple();
    const entry = await v.createEntry({ title: 'Overview' });
    await v.saveEntry(entry.id, 'Nothing yet.\n');
    const file = path.join(v.root, v.entries.get(entry.id)!.file);
    const content = await readFile(file, 'utf8');
    await writeFile(file, content.replace('Nothing yet.', 'Edited in Notepad about @Scouch.'));
    const changed = await v.handleExternalChange(file);
    expect(changed).toBe(true);
    const b = blockWith('Edited in Notepad');
    expect(onProfile(s, b.id)).toBe(true);
    // Our own writes are ignored.
    expect(await v.handleExternalChange(file)).toBe(false);
  });

  it('T20b: new paragraphs added outside the app get permanent ids written back', async () => {
    const entry = await v.createEntry({ title: 'Overview' });
    const file = path.join(v.root, v.entries.get(entry.id)!.file);
    await writeFile(file, (await readFile(file, 'utf8')) + '\nFirst.\n\nSecond.\n');
    await v.handleExternalChange(file);
    const ids = splitBlocks(v.getEntry(entry.id).body).map((b) => b.id);
    expect(ids).toHaveLength(2);
    expect(ids.every((x) => /^b-/.test(x ?? ''))).toBe(true);
    expect(await readFile(file, 'utf8')).toMatch(/Second\. \^b-[a-z0-9]+/);
  });

  it('T24: an inline @@ inside a section files to both; the next paragraph only to the owner', async () => {
    const { s } = await scouchAndPineapple();
    const entry = await v.createEntry({ title: 'Overview' });
    await v.saveEntry(entry.id, '## Apple Scouch @\n\nScouch taught in the northern province.\n\n@@Chamberlain Pineapple studied under him.\n\nHe travelled widely.\n');
    const p = [...v.entities.values()].find((e) => e.name === 'Chamberlain Pineapple')!.id;
    const both = blockWith('studied under him');
    expect(both.filedTo.map((f) => f.entityId).sort()).toEqual([s, p].sort());
    const next = blockWith('travelled widely');
    expect(next.filedTo.map((f) => f.entityId)).toEqual([s]);
  });

  it('T25: a sub-heading tag files to both people (two stripe colours)', async () => {
    const { s, p } = await scouchAndPineapple();
    const entry = await v.createEntry({ title: 'Overview' });
    await v.saveEntry(
      entry.id,
      "## Apple Scouch @\n\nScouch taught.\n\n### Pineapple's objections @Chamberlain Pineapple\n\nHe argued repentance must come first.\n\n## Chamberlain Pineapple @\n\nIn later life he retired to the coast.\n",
    );
    expect(blockWith('Scouch taught').filedTo.map((f) => f.entityId)).toEqual([s]);
    expect(blockWith('repentance must come first').filedTo.map((f) => f.entityId).sort()).toEqual([s, p].sort());
    expect(blockWith('retired to the coast').filedTo.map((f) => f.entityId)).toEqual([p]);
  });

  it('T26: @-Name opts one block out of the section owner', async () => {
    const { s } = await scouchAndPineapple();
    const entry = await v.createEntry({ title: 'Overview' });
    await v.saveEntry(entry.id, '## Apple Scouch @\n\nAbout him.\n\nAn aside about the weather. @-Scouch\n');
    expect(onProfile(s, blockWith('About him').id)).toBe(true);
    expect(onProfile(s, blockWith('the weather').id)).toBe(false);
  });

  it('T39: "Add a fact" offers the fields of the last tagged entity\'s template', async () => {
    await scouchAndPineapple();
    const text = '@Apple Scouch was born in ';
    const fields = factPickerFields(text, text.length, v.names, (id) => v.entities.get(id)?.type, v.templates);
    expect(fields?.entityName).toBe('Apple Scouch');
    expect(fields?.fields.map((f) => f.key)).toEqual(expect.arrayContaining(['born', 'died', 'region', 'see_office']));
  });

  it('T41: binder nesting, drag reorder saved, chapter word count totals its scenes', async () => {
    const folder = await v.createFolder({ name: 'Book' });
    const ch = await v.createEntry({ title: 'Chapter 1', parent: { kind: 'folder', path: folder } });
    const s1 = await v.createEntry({ title: 'Scene 1', parent: { kind: 'entry', id: ch.id }, body: 'one two three\n' });
    const s2 = await v.createEntry({ title: 'Scene 2', parent: { kind: 'entry', id: ch.id }, body: 'four five\n' });
    const s3 = await v.createEntry({ title: 'Scene 3', parent: { kind: 'entry', id: ch.id }, body: 'six\n' });
    await v.moveNode({ kind: 'entry', id: s3.id }, { kind: 'entry', id: ch.id }, 0);
    const tree = await v.getBinder();
    const book = tree.find((n) => n.name === 'Book')!;
    const chapter = book.children[0];
    expect(chapter.name).toBe('Chapter 1');
    expect(chapter.children.map((c) => c.name)).toEqual(['Scene 3', 'Scene 1', 'Scene 2']);
    expect(chapter.words).toBe(6);
    expect(book.words).toBe(6);
    // Order survives a reopen.
    const v2 = await Vault.open(v.root, { author: 'tester' });
    const again = (await v2.getBinder()).find((n) => n.name === 'Book')!.children[0].children.map((c) => c.id);
    expect(again).toEqual([s3.id, s1.id, s2.id]);
  });

  it('T52: every block stores author, created time, history and status approved', async () => {
    const entry = await v.createEntry({ title: 'Overview' });
    await v.saveEntry(entry.id, 'A block.\n');
    const b = blockWith('A block.');
    const m = v.meta.get(b.id)!;
    expect(m.author).toBe('tester');
    expect(m.created).toMatch(/^\d{4}-/);
    expect(m.status).toBe('approved');
    expect(m.history).toHaveLength(1);
    expect(existsSync(path.join(v.root, '.meta', 'blocks'))).toBe(true);
  });

  it('quick switcher finds entries and entities by name or alias; full-text search finds blocks', async () => {
    const { s } = await scouchAndPineapple();
    await v.updateEntity(s, { aliases: ['the Vine Doctor'] });
    const entry = await v.createEntry({ title: 'Early Church Fathers — overview' });
    await v.saveEntry(entry.id, '@Scouch preached on the vine and the branches.\n');
    expect(quickSwitch(v, 'vine doc')[0].id).toBe(s);
    expect(quickSwitch(v, 'early')[0].id).toBe(entry.id);
    const hits = searchBlocks(v, 'vine branches');
    expect(hits).toHaveLength(1);
    expect(hits[0].block.source.title).toBe('Early Church Fathers — overview');
  });

  it('fields typed in blocks fill the fact box; conflicting values are marked disputed', async () => {
    const { p } = await scouchAndPineapple();
    const entry = await v.createEntry({ title: 'Overview' });
    await v.saveEntry(entry.id, '@Chamberlain Pineapple {born: ~1290} {died: 1351} rejected the view.\n\nLater sources say @Pineapple {died: 1352}.\n');
    const died = buildProfile(v, p).facts.find((f) => f.key === 'died')!;
    expect(died.values.map((x) => x.text)).toEqual(['1351', '1352']);
    expect(died.disputed).toBe(true);
    const warn = await v.createEntry({ title: 'W' });
    await v.saveEntry(warn.id, 'Nobody here {died: 1351}.\n');
    expect(blockWith('Nobody here').warnings[0].code).toBe('field-no-entity');
  });

  it('direct notes written on a profile go into its sections', async () => {
    const { s } = await scouchAndPineapple();
    await v.addProfileNote(s, 'Life', 'He is often confused with his nephew.');
    const b = blockWith('confused with his nephew');
    expect(b.file).toBe('entities/people/Apple Scouch.md');
    expect(sectionOf(s, b.id)).toBe('Life');
  });

  it('rebuilds 10,000 blocks well under 30 seconds', async () => {
    await scouchAndPineapple();
    for (let i = 0; i < 20; i++) {
      const paras = Array.from({ length: 500 }, (_, k) => `Paragraph ${k} about @Scouch and @Pineapple >disagrees_with> @Scouch in {year: ${1300 + (k % 50)}}.`);
      await writeFile(path.join(v.root, 'entries', `bulk-${i}.md`), `---\ntitle: Bulk ${i}\n---\n\n${paras.join('\n\n')}\n`);
    }
    const t0 = Date.now();
    const v2 = await Vault.open(v.root, { author: 'tester' });
    const ms = Date.now() - t0;
    expect([...v2.blocks.values()].filter((b) => b.owner.kind === 'entry').length).toBe(10000);
    expect(ms).toBeLessThan(30000);
    // Second open (ids already written) is the steady-state cost.
    const t1 = Date.now();
    await Vault.open(v.root, { author: 'tester' });
    console.log(`first open ${ms} ms, steady-state open ${Date.now() - t1} ms for 10,000 blocks`);
  });

  it('family facts are two-way: {mother: @Anna} lists this person under Anna\'s Children', async () => {
    const { p } = await scouchAndPineapple();
    const anna = await v.createEntity({ name: 'Anna Pineapple', type: 'church-father' });
    const entry = await v.createEntry({ title: 'Family' });
    await v.saveEntry(entry.id, '@Chamberlain Pineapple {mother: @Anna Pineapple} {friends: @Apple Scouch, @Anna Pineapple}\n');
    const annaView = buildProfile(v, anna.id);
    expect(annaView.facts.find((f) => f.key === 'children')!.values.map((x) => x.entity?.id)).toEqual([p]);
    expect(annaView.facts.find((f) => f.key === 'friends')!.values[0].via).toBe("Chamberlain Pineapple's friends");
    const pv = buildProfile(v, p);
    expect(pv.facts.find((f) => f.key === 'friends')!.values.map((x) => x.text)).toEqual(['Apple Scouch', 'Anna Pineapple']);
  });

  it('a concept page groups paragraphs by the document they came from, in reading order', async () => {
    const topic = await v.createEntity({ name: 'Prophecies about the Jews', type: 'topic' });
    const a = await v.createEntry({ title: 'What God said' });
    const b = await v.createEntry({ title: 'What they did' });
    await v.saveEntry(a.id, 'A1 #prophecies-about-the-jews\n');
    await v.saveEntry(b.id, 'B1 #prophecies-about-the-jews\n');
    await v.saveEntry(a.id, 'A1 #prophecies-about-the-jews\n\nA2 #prophecies-about-the-jews\n');
    await v.saveEntry(b.id, 'B1 #prophecies-about-the-jews\n\nB2 #prophecies-about-the-jews\n');
    const groups = buildProfile(v, topic.id).elsewhere.flatMap((s) => s.groups);
    expect(groups.map((g) => g.source.title)).toEqual(['What God said', 'What they did']);
    expect(groups.map((g) => g.blocks.map((x) => x.text.slice(0, 2)))).toEqual([['A1', 'A2'], ['B1', 'B2']]);
  });

  it('a heading over a tagged paragraph becomes its section on the profile', async () => {
    const { s } = await scouchAndPineapple();
    const entry = await v.createEntry({ title: 'Notes' });
    await v.saveEntry(entry.id, '## His exile\n\n@Scouch left the city in winter.\n');
    expect(sectionOf(s, blockWith('left the city').id)).toBe('His exile');
  });

  it('new profiles start with their template sections as headings; templates can be edited', async () => {
    const { s } = await scouchAndPineapple();
    const body = v.files.get(v.entities.get(s)!.file)!.body;
    expect(body).toMatch(/^## Life \^b-/m);
    expect(body).not.toContain('## Summary');
    const tpl = v.rawTemplate('church-father');
    await v.saveTemplate({ ...tpl, sections: [...tpl.sections, 'Travels'], fields: [...tpl.fields, { key: 'nickname', label: 'Nickname', kind: 'text' }] });
    expect(v.template('church-father').sections).toContain('Travels');
    expect(buildProfile(v, s).facts.some((f) => f.key === 'nickname')).toBe(true);
  });

  it('marked paragraphs show in the page\'s Key details and the project-wide list', async () => {
    const { s: sc } = await scouchAndPineapple();
    const entry = await v.createEntry({ title: 'Notes' });
    await v.saveEntry(entry.id, '@Scouch burned his letters in 1330. !key\n\n@Scouch may have met the emperor. !check\n\nOrdinary line about @Scouch.\n\nThe !!third letter!! survives.\n');
    expect(buildProfile(v, sc).keyDetails.map((b) => b.text.slice(0, 20))).toEqual(['@Scouch burned his l', '@Scouch may have met']);
    const all = keyDetails(v);
    expect(all).toHaveLength(1);
    expect(all[0].blocks).toHaveLength(3);
    expect(keyDetails(v, { mark: 'check' })[0].blocks).toHaveLength(1);
    expect(keyDetails(v, { mark: 'phrase' })[0].blocks[0].keyPhrases).toEqual(['third letter']);
  });
});
