import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Vault } from '../src/core/vault';
import { autoAliases, ordinalSuffix, ordinalWord } from '../src/core/ordinals';

describe('ordinal names', () => {
  it('spells ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 112].map(ordinalSuffix)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '112th']);
    expect([1, 6, 12, 20, 21, 40, 99, 100].map(ordinalWord)).toEqual(['first', 'sixth', 'twelfth', 'twentieth', 'twenty-first', 'fortieth', 'ninety-ninth', undefined]);
    expect(autoAliases({ office: 'Pope', succession: 6 })).toEqual(['6th Pope', 'Sixth Pope']);
    expect(autoAliases({ office: '@[Pope]', succession: '1' })).toEqual(['1st Pope', 'First Pope']);
    expect(autoAliases({ office: 'Pope' })).toEqual([]);
  });
});

describe('office holders in the text', () => {
  let dir: string;
  let v: Vault;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'lr-ord-'));
    v = await Vault.create(path.join(dir, 'Scholarship'), { name: 'Scholarship', pack: 'scholarship', author: 't' });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('finds “the 6th pope” and “the Sixth Pope” as the person', async () => {
    const sixtus = await v.createEntity({ name: 'Sixtus I', type: 'person' });
    await v.updateEntity(sixtus.id, { fields: { office: 'Pope', succession: 6 } });
    expect(v.chip(v.entities.get(sixtus.id)!).autoAliases).toEqual(['6th Pope', 'Sixth Pope']);
    const e = await v.createEntry({ title: 'Early bishops' });
    await v.saveEntry(e.id, 'Under the 6th pope the church grew. The Sixth Pope wrote little.\n\nWe know of @6th Pope from Irenaeus.');
    const found = v.scan({ doc: { kind: 'entry', id: e.id } }).suggestions.filter((s) => s.kind === 'mention');
    expect(found.map((s) => s.entityIds[0])).toEqual([sixtus.id]);
    expect(found[0].count).toBe(2);
    // The typed tag resolves to him too.
    const tagged = [...v.blocks.values()].find((b) => b.text.startsWith('We know'))!;
    expect(tagged.filedTo.map((f) => f.entityId)).toContain(sixtus.id);
    await v.acceptSuggestion(found[0].id);
    expect(v.getEntry(e.id).body).toMatch(/@\[?(Sixtus I\|)?6th pope\]?/);
  });
});
