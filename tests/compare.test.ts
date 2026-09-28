import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Vault } from '../src/core/vault';
import { entityTable, parallelView, tableCsv, wordDiff } from '../src/core/compare';
import { keyDetails } from '../src/core/views';

let dir: string;
let v: Vault;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'lr-cmp-'));
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

describe('extraction tables', () => {
  it('lists pages with facts, counts, dates and word counts', async () => {
    await entry('Notes', '@@Irenaeus {born: 130} was bishop of Lyon. He wrote on baptism.\n\n@Irenaeus {died: 202} wrote against the heresies.\n\n@@Tertullian {born: 155} {born: 160} wrote on baptism and on prayer.');
    await v.updateEntity([...v.entities.values()].find((e) => e.name === 'Irenaeus')!.id, { type: 'church-father' });
    await v.updateEntity([...v.entities.values()].find((e) => e.name === 'Tertullian')!.id, { type: 'church-father' });
    const t = entityTable(v, { types: ['church-father'], fields: ['born', 'died', '@mentions', '#baptism'] });
    expect(t.columns.map((c) => c.label)).toEqual(['Born', 'Died', 'Paragraphs', '“baptism”']);
    const iren = t.rows.find((r) => r.name === 'Irenaeus')!;
    expect(iren.cells.born.text).toBe('130');
    expect(iren.cells.died.text).toBe('202');
    expect(iren.cells['@mentions'].text).toBe('2');
    expect(iren.cells['#baptism'].text).toBe('1');
    const tert = t.rows.find((r) => r.name === 'Tertullian')!;
    expect(tert.cells.born).toMatchObject({ text: '155 / 160', disputed: true });
    expect(tableCsv(t).split('\n')[0]).toBe('Name,Born,Died,Paragraphs,“baptism”');
  });
});

describe('parallel accounts', () => {
  it('lines up translations and commentary by verse', async () => {
    const kjv = await v.importLibrary({ title: 'KJV', translation: 'KJV', text: ['John 1:1 In the beginning was the Word, and the Word was with God.', 'John 1:2 The same was in the beginning with God.', 'John 1:3 All things were made by him.', 'Gen 1:1 In the beginning God created.', 'Gen 1:2 And the earth was without form.'].join('\n') });
    const web = await v.importLibrary({ title: 'WEB', translation: 'WEB', text: ['John 1:1 In the beginning was the Word, and the Word was with God, and the Word was God.', 'John 1:3 All things were made through him.', 'Gen 1:1 In the beginning, God created the heavens and the earth.', 'Gen 1:2 The earth was formless and empty.', 'Gen 1:3 God said, Let there be light.'].join('\n') });
    const notes = await entry('On John', 'The prologue (John 1:1) echoes Genesis.\n\nVerse three, John 1:3, is about creation.');
    const johnK = v.listLibrary().find((l) => l.title === 'John (KJV)')!.id;
    const johnW = v.listLibrary().find((l) => l.title === 'John (WEB)')!.id;
    void kjv;
    void web;
    const r = parallelView(v, {
      align: 'verse',
      columns: [{ source: { kind: 'library', id: johnK } }, { source: { kind: 'library', id: johnW } }, { source: { kind: 'entry', id: notes } }],
    });
    expect(r.columns.map((c) => c.label)).toEqual(['John (KJV)', 'John (WEB)', 'On John']);
    expect(r.rows.map((x) => x.label)).toEqual(['John 1:1', 'John 1:2', 'John 1:3']);
    const first = r.rows[0];
    expect(first.cells.map((c) => c.length)).toEqual([1, 1, 1]);
    expect(r.rows[1].cells[1]).toEqual([]);
    const d = wordDiff(first.cells[0][0].text, first.cells[1][0].text);
    expect(d.map(([a, b]) => first.cells[1][0].text.slice(a, b))).toEqual(['and the Word was God']);
  });
});

describe('claims & evidence', () => {
  it('keeps evidence for and against a claim, and claims stay out of key details', async () => {
    const id = await entry('Thesis', 'The Shepherd was widely read as Scripture before 200. !claim\n\nIrenaeus quotes the Shepherd as Scripture.\n\nThe Muratorian fragment says it may not be read publicly.');
    const blocks = [...v.blocks.values()].filter((b) => b.owner.id === id).sort((a, b) => a.position - b.position);
    const [claim, pro, con] = blocks;
    expect(claim.marks).toEqual(['claim']);
    expect(keyDetails(v)).toEqual([]);
    await v.addEvidence(claim.id, pro.id, 'for');
    await v.addEvidence(claim.id, con.id, 'against', 'but still to be read privately');
    let list = await v.listClaims();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: 'contested' });
    expect(list[0].evidence.map((e) => [e.stance, e.note])).toEqual([
      ['for', undefined],
      ['against', 'but still to be read privately'],
    ]);
    await v.removeEvidence(claim.id, con.id);
    list = await v.listClaims();
    expect(list[0].status).toBe('supported');
    await v.toggleClaim(claim.id);
    expect(await v.listClaims()).toEqual([]);
    expect(v.getEntry(id).body).toContain('before 200.');
    expect(v.getEntry(id).body).not.toContain('!claim');
  });
});
