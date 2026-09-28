import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Vault } from '../src/core/vault';
import { entitySpans, itemVisible, snapshot } from '../src/core/maps';

let dir: string;
let v: Vault;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'lr-map-'));
  v = await Vault.create(path.join(dir, 'World'), { name: 'World', pack: 'fantasy', author: 't' });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('maps and snapshots', () => {
  it('knows when pages begin and end, and what existed in a year', async () => {
    await v.createEntity({ name: 'Old Harbour', type: 'place' });
    await v.createEntity({ name: 'Queen Mara', type: 'character' });
    await v.createEntity({ name: 'Young Tobin', type: 'character' });
    const e = await v.createEntry({ title: 'History' });
    await v.saveEntry(e.id, '@Queen Mara {born: 300} {died: 360} ruled the coast.\n\n@Old Harbour {founded: 250} {fell: 340} was her capital.\n\n@Young Tobin {born: 350} was her grandson.\n\n{year: 330} The great flood reached @Old Harbour.');
    const spans = entitySpans(v);
    const id = (n: string) => [...v.entities.values()].find((x) => x.name === n)!.id;
    expect(spans[id('Queen Mara')]).toEqual({ start: 300, end: 360 });
    expect(spans[id('Old Harbour')]).toEqual({ start: 250, end: 340 });
    const s = snapshot(v, 330);
    expect(s.existing.map((x) => x.name).sort()).toEqual(['Old Harbour', 'Queen Mara']);
    expect(s.existing.find((x) => x.name === 'Queen Mara')!.age).toBe(30);
    expect(s.events.map((x) => x.text)).toEqual(['330 The great flood reached Old Harbour.']);
    expect(s.range).toEqual({ min: 250, max: 360 });
    expect(snapshot(v, 345).existing.map((x) => x.name)).toEqual(['Queen Mara']);
    expect(snapshot(v, 500).existing.map((x) => x.name)).toEqual([]); // Tobin assumed gone after 90 years
    expect(itemVisible({ entity: id('Old Harbour') }, spans[id('Old Harbour')], 345)).toBe(false);
    expect(itemVisible({ entity: id('Old Harbour'), to: 400 }, spans[id('Old Harbour')], 345)).toBe(true);
    expect(itemVisible({}, undefined, 345)).toBe(true);
  });

  it('stores a map image and its drawings', async () => {
    const view = await v.createView({ name: 'The coast', kind: 'map' });
    await v.saveMapImage(view.id, 'data:image/png;base64,iVBORw0KGgo=');
    await expect(v.saveMapImage(view.id, 'hello')).rejects.toThrow(/not an image/);
    await v.saveView({ ...view, image: { width: 800, height: 600 }, markers: [{ id: 'm1', x: 0.5, y: 0.25, label: 'Harbour' }], regions: [{ id: 'r1', points: [[0.1, 0.1], [0.3, 0.1], [0.2, 0.3]], label: 'Coast' }] });
    const v2 = await Vault.open(v.root, { author: 't' });
    const got = (await v2.listViews()).find((x) => x.id === view.id)!;
    expect(got.markers?.[0]).toMatchObject({ x: 0.5, y: 0.25, label: 'Harbour' });
    expect(got.regions?.[0].points).toHaveLength(3);
    expect(await v2.getMapImage(view.id)).toBe('data:image/png;base64,iVBORw0KGgo=');
  });
});
