// Block authorship and edit history (spec 8 "Version history" and 18.5).
//
// Stored as plain JSON under `.meta/blocks/`, sharded by the first characters of
// the block id so that moving a block between files never moves its history,
// and so that sync tools see small files. Unlike `.index/`, this folder is part
// of the vault and must not be deleted.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { BlockMeta, BlockStatus } from './types';

export class MetaStore {
  private shards = new Map<string, Record<string, BlockMeta>>();
  private dirty = new Set<string>();

  constructor(private dir: string) {}

  static shardOf(id: string): string {
    return id.slice(2, 4).padEnd(2, '_');
  }

  async load(): Promise<void> {
    this.shards.clear();
    let names: string[] = [];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return;
    }
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      try {
        const data = JSON.parse(await fs.readFile(path.join(this.dir, n), 'utf8'));
        this.shards.set(n.slice(0, -5), data);
      } catch {
        // A corrupt shard loses history for its blocks but never blocks opening the vault.
      }
    }
  }

  get(id: string): BlockMeta | undefined {
    return this.shards.get(MetaStore.shardOf(id))?.[id];
  }

  private put(id: string, meta: BlockMeta): void {
    const s = MetaStore.shardOf(id);
    if (!this.shards.has(s)) this.shards.set(s, {});
    this.shards.get(s)![id] = meta;
    this.dirty.add(s);
  }

  /**
   * Record that block `id` now has `text`. Creates the record on first sight and
   * appends a history entry when the text changed. Returns the (updated) record.
   */
  touch(id: string, text: string, by: string, at = new Date().toISOString()): BlockMeta {
    const cur = this.get(id);
    if (!cur) {
      const meta: BlockMeta = { author: by, created: at, modified: at, modifiedBy: by, status: 'approved', approvedBy: by, approvedAt: at, history: [{ at, by, text }] };
      this.put(id, meta);
      return meta;
    }
    const last = cur.history[cur.history.length - 1];
    if (cur.status === 'deleted') {
      cur.status = 'approved';
      this.dirty.add(MetaStore.shardOf(id));
    }
    if (!last || last.text !== text) {
      cur.history.push({ at, by, text });
      cur.modified = at;
      cur.modifiedBy = by;
      this.dirty.add(MetaStore.shardOf(id));
    }
    return cur;
  }

  setStatus(id: string, status: BlockStatus, by: string): void {
    const cur = this.get(id);
    if (!cur) return;
    cur.status = status;
    cur.modified = new Date().toISOString();
    cur.modifiedBy = by;
    this.dirty.add(MetaStore.shardOf(id));
  }

  async flush(): Promise<void> {
    if (!this.dirty.size) return;
    await fs.mkdir(this.dir, { recursive: true });
    const shards = [...this.dirty];
    this.dirty.clear();
    await Promise.all(
      shards.map((s) => fs.writeFile(path.join(this.dir, `${s}.json`), JSON.stringify(this.shards.get(s) ?? {}, null, 1))),
    );
  }
}
