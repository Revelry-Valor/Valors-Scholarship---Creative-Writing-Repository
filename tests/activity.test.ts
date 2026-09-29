import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Vault } from '../src/core/vault';
import { sectionName } from '../src/core/scan';
import { buildProfile } from '../src/core/views';

let dir: string;
let v: Vault;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'lr-act-'));
  v = await Vault.create(path.join(dir, 'Scholarship'), { name: 'Scholarship', pack: 'scholarship', author: 't' });
  await v.createEntity({ name: 'Dr James White', type: 'person' });
  await v.createEntity({ name: 'Pope', type: 'topic' });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function entry(title: string, body: string) {
  const e = await v.createEntry({ title });
  await v.saveEntry(e.id, body);
  return e.id;
}

describe('activities: “had a sermon”', () => {
  it('names sections from the kind of work', () => {
    expect(['sermon', 'sermons', 'homily', 'speech', 'bible study', 'series', 'class', 'book'].map(sectionName)).toEqual(['Sermons', 'Sermons', 'Homilies', 'Speeches', 'Bible studies', 'Series', 'Classes', 'Books']);
  });

  it('asks to file the paragraph under the person’s Sermons, which then sort by date', async () => {
    const a = await entry(
      'Sermon on Peter',
      'With @@Apologia Church on @@Apologia Studios @Dr James White Had a sermon over Peter an apostle of Christ and the Papacy or @Pope. This sermon took place Jan/21/2024',
    );
    const b = await entry('Earlier sermon', '@Dr James White preached a sermon on Romans 9 on May 4th 2019.');
    const act = v.scan({ doc: { kind: 'entry', id: a } }).suggestions.find((s) => s.kind === 'activity')!;
    expect(act).toMatchObject({ section: 'Sermons', match: 'Had a sermon' });
    await v.acceptSuggestion(act.id);
    expect(v.getEntry(a).body).toContain('@Dr James White::Sermons Had a sermon');
    const act2 = v.scan({ doc: { kind: 'entry', id: b } }).suggestions.find((s) => s.kind === 'activity')!;
    await v.acceptSuggestion(act2.id);
    // No second suggestion once filed.
    expect(v.scan({ doc: { kind: 'entry', id: a } }).suggestions.some((s) => s.kind === 'activity')).toBe(false);
    const james = [...v.entities.values()].find((e) => e.name === 'Dr James White')!;
    const profile = buildProfile(v, james.id);
    const sermons = profile.elsewhere.find((s) => s.name === 'Sermons')!;
    // Oldest first, by the dates written in the text.
    expect(sermons.groups.map((g) => g.source.title)).toEqual(['Earlier sermon', 'Sermon on Peter']);
    // The page got a Sermons heading to hold them.
    expect(v.files.get(james.file)!.body).toMatch(/## Sermons/);
  });
});
