// Name and alias lookup. Matching ignores case and possessives ("Scouch's"),
// and a single word resolves to an entity when exactly one entity has that
// word in its name ("@Pineapple" → Chamberlain Pineapple).

import { normalizeName, type NameResolver, type Resolution } from './markup';

export interface NamedEntity {
  id: string;
  name: string;
  aliases: string[];
  type?: string;
}

const PARTICLES = new Set(['of', 'the', 'de', 'la', 'le', 'von', 'van', 'der', 'da', 'di', 'du', 'al', 'el', 'bin', 'ibn', 'ben', 'y', 'and', 'a', 'an']);

export class NameTable implements NameResolver {
  private exact = new Map<string, Set<string>>();
  private words = new Map<string, Set<string>>();
  private prefixes = new Map<string, string[]>();
  readonly entities = new Map<string, NamedEntity>();

  constructor(entities: Iterable<NamedEntity> = []) {
    for (const e of entities) this.add(e);
  }

  add(e: NamedEntity): void {
    this.entities.set(e.id, e);
    const names = [e.name, ...e.aliases].filter((n) => n && n.trim());
    for (const n of names) {
      const key = normalizeName(n);
      if (!this.exact.has(key)) this.exact.set(key, new Set());
      this.exact.get(key)!.add(e.id);
      const first = key.split(' ')[0];
      const list = this.prefixes.get(first) ?? [];
      list.push(n);
      list.sort((a, b) => b.length - a.length);
      this.prefixes.set(first, list);
    }
    for (const w of normalizeName(e.name).split(' ')) {
      if (w.length < 2 || PARTICLES.has(w)) continue;
      if (!this.words.has(w)) this.words.set(w, new Set());
      this.words.get(w)!.add(e.id);
    }
  }

  matchPrefix(text: string): string | null {
    const m = /^[\p{L}\p{N}_'’-]+/u.exec(text);
    if (!m) return null;
    const first = normalizeName(m[0]);
    const cands = this.prefixes.get(first);
    if (!cands) return null;
    const lower = text.toLowerCase();
    for (const c of cands) {
      const cl = c.toLowerCase();
      if (!lower.startsWith(cl)) continue;
      const next = text[c.length];
      if (next === undefined || !/[\p{L}\p{N}_]/u.test(next)) return text.slice(0, c.length);
    }
    return null;
  }

  resolve(name: string): Resolution {
    const key = normalizeName(name);
    if (!key) return { status: 'missing' };
    const hit = this.exact.get(key);
    if (hit && hit.size === 1) return { status: 'ok', id: [...hit][0] };
    if (hit && hit.size > 1) return { status: 'ambiguous', ids: [...hit] };
    if (!key.includes(' ')) {
      const w = this.words.get(key);
      if (w && w.size === 1) return { status: 'ok', id: [...w][0] };
      if (w && w.size > 1) return { status: 'ambiguous', ids: [...w] };
    }
    return { status: 'missing' };
  }

  /** All entities a typed name could mean, exact matches first. */
  candidates(name: string): string[] {
    const key = normalizeName(name);
    const out = new Set<string>(this.exact.get(key) ?? []);
    for (const w of key.split(' ')) for (const id of this.words.get(w) ?? []) out.add(id);
    return [...out];
  }
}
