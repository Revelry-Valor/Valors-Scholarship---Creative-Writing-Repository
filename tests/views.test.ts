// Trees, radial charts and timelines are drawn from what you wrote.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Vault } from '../src/core/vault';
import { buildGraph, buildTimeline } from '../src/core/graph';

let dir: string;
let v: Vault;
const id = (name: string) => [...v.entities.values()].find((e) => e.name === name)!.id;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'lr-views-'));
  v = await Vault.create(path.join(dir, 'World'), { name: 'The Old Empire', pack: 'fantasy', author: 'tester' });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('graph and timeline', () => {
  it('builds family edges from facts and relationships, one edge per fact', async () => {
    for (const n of ['Aldric', 'Mera', 'Tomas', 'Lena']) await v.createEntity({ name: n, type: 'character' });
    const e = await v.createEntry({ title: 'House Aldric' });
    await v.saveEntry(e.id, '@Tomas {father: @Aldric} {mother: @Mera}\n\n@Aldric {spouse: @Mera}\n\n@Lena >child_of> @Aldric\n');
    const g = buildGraph(v);
    const parents = g.edges.filter((x) => x.kind === 'parent').map((x) => `${x.from}>${x.to}`).sort();
    expect(parents).toEqual([`${id('Aldric')}>${id('Lena')}`, `${id('Aldric')}>${id('Tomas')}`, `${id('Mera')}>${id('Tomas')}`].sort());
    expect(g.edges.filter((x) => x.kind === 'spouse')).toHaveLength(1);
  });

  it('keeps one-sided feelings as two different arrows (T36)', async () => {
    await v.createEntity({ name: 'Zeryth', type: 'religion' });
    await v.createEntity({ name: 'Ilura', type: 'religion' });
    const e = await v.createEntry({ title: 'Gods' });
    await v.saveEntry(e.id, '@Zeryth >despises> @Ilura\n\n@Ilura >admires> @Zeryth\n');
    const g = buildGraph(v).edges;
    expect(g.find((x) => x.kind === 'despises')).toMatchObject({ from: id('Zeryth'), to: id('Ilura'), category: 'conflict' });
    expect(g.find((x) => x.kind === 'admires')).toMatchObject({ from: id('Ilura'), to: id('Zeryth'), category: 'agreement' });
  });

  it('turns "requires" into a tech tree edge from prerequisite to technology', async () => {
    await v.createEntity({ name: 'Bronze', type: 'technology' });
    const iron = await v.createEntity({ name: 'Iron', type: 'technology' });
    await v.updateEntity(iron.id, { fields: { requires: ['@Bronze'] } });
    expect(buildGraph(v).edges).toContainEqual(expect.objectContaining({ from: id('Bronze'), to: iron.id, kind: 'leads_to' }));
  });

  it('puts life spans and dated paragraphs on the timeline', async () => {
    await v.createEntity({ name: 'Aldric', type: 'character' });
    const e = await v.createEntry({ title: 'Siege' });
    await v.saveEntry(e.id, '@Aldric {born: 380} {died: 441}\n\nIn {year: 412} @Aldric besieged the keep.\n');
    const t = buildTimeline(v).events;
    expect(t.find((x) => x.kind === 'life')).toMatchObject({ sort: 380, end: 441, label: 'Aldric' });
    expect(t.find((x) => x.kind === 'event')?.sort).toBe(412);
  });

  it('adds new types to a project and saves views', async () => {
    const s = await Vault.create(path.join(dir, 'Scholarship'), { name: 'Scholarship', pack: 'scholarship', author: 't' });
    expect(s.availableTemplates().map((t) => t.id)).toEqual(expect.arrayContaining(['settlement', 'flora', 'fauna', 'technology', 'species']));
    await s.addTemplate({ id: 'fauna' });
    expect(s.template('fauna').fields.some((f) => f.key === 'eats')).toBe(true);
    await s.addTemplate({ name: 'Heresy' });
    expect(s.templates.has('heresy')).toBe(true);
    const view = await s.createView({ name: 'Christian History', kind: 'timeline' });
    await s.saveView({ ...view, lanes: 'entity' });
    expect((await s.listViews())[0]).toMatchObject({ name: 'Christian History', kind: 'timeline', lanes: 'entity' });
  });
});
