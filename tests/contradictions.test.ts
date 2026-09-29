import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Vault } from '../src/core/vault';
import { findContradictions } from '../src/core/contradictions';

let dir: string;
let v: Vault;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'lr-con-'));
  v = await Vault.create(path.join(dir, 'Scholarship'), { name: 'Scholarship', pack: 'scholarship', author: 't' });
  await v.createEntity({ name: 'Apple Scouch', type: 'church-father' });
  await v.createEntity({ name: 'Chamberlain Pineapple', type: 'church-father' });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function entry(title: string, body: string) {
  const e = await v.createEntry({ title });
  await v.saveEntry(e.id, body);
  return e.id;
}

describe('contradiction finder', () => {
  it('finds differing facts and impossible dates', async () => {
    await entry('A', '@Apple Scouch {born: 1280} studied in the north.\n\n@Apple Scouch {died: 1270} was buried at home.');
    await entry('B', '@Apple Scouch {born: 1290} was the youngest of five.\n\n@Apple Scouch wrote a letter in 1300.');
    const list = findContradictions(v);
    const kinds = list.map((c) => c.kind);
    expect(kinds).toContain('facts');
    expect(list.find((c) => c.kind === 'facts')!.title).toBe('Apple Scouch: Born is 1280 and 1290');
    expect(list.find((c) => c.id.startsWith('dates|order'))!.title).toMatch(/died 1270 is before born 1280/);
    const after = list.find((c) => c.id.startsWith('dates|after'))!;
    expect(after.title).toBe('Apple Scouch acts in 1300, after died 1270');
    expect(after.a.text).toContain('wrote a letter');
  });

  it('finds opposite links and opposite statements', async () => {
    await entry('C', '@Apple Scouch >agrees_with> @Chamberlain Pineapple on grace.\n\n@Chamberlain Pineapple >disagrees_with> @Apple Scouch on repentance.');
    await entry('D', '@Apple Scouch accepted @Chamberlain Pineapple as a teacher.\n\n@Apple Scouch never accepted @Chamberlain Pineapple as a teacher.');
    const list = findContradictions(v);
    const rel = list.find((c) => c.kind === 'relations')!;
    expect(rel.title).toMatch(/agrees with.*disagrees with/i);
    const st = list.find((c) => c.kind === 'statements')!;
    expect(st.title).toBe('Apple Scouch accepts / rejects Chamberlain Pineapple');
    expect(st.a.spans).toBeTruthy();
  });

  it('finds an author giving two verdicts on one writing, and respects dismissals', async () => {
    await v.importLibrary({
      title: 'History',
      author: 'Eusebius',
      kind: 'text',
      text: 'After them is to be placed the Apocalypse of John. These then belong among the accepted writings.\n\nSome, as I said, reject the Apocalypse of John, which others class with the accepted books.\n\nOn other matters he was silent.',
    });
    const list = findContradictions(v);
    const canon = list.find((c) => c.kind === 'canon')!;
    expect(canon.title).toMatch(/Eusebius: Revelation.*received and (rejected|disputed)/);
    expect(findContradictions(v, new Set([canon.id])).some((c) => c.kind === 'canon')).toBe(false);
  });
});
