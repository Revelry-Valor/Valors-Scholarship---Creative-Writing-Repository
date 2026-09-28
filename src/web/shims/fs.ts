// In-memory stand-in for node:fs, used only by the browser demo build.
// Files persist to IndexedDB so a demo vault survives a reload.

const KEY = 'lr.demo.fs.v1';
const files = new Map<string, string>();
const dirs = new Set<string>(['/']);

function norm(p: string): string {
  const parts: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return '/' + parts.join('/');
}
function parent(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}
function addDirs(p: string) {
  for (let d = p; ; d = parent(d)) {
    dirs.add(d);
    if (d === '/') break;
  }
}
function enoent(p: string): Error {
  const e = new Error(`ENOENT: no such file or directory, '${p}'`) as Error & { code: string };
  e.code = 'ENOENT';
  return e;
}

// Files live in IndexedDB (one record per file), which holds far more than
// localStorage: a whole imported Bible or a shelf of Church Fathers fits.
const DB = 'lr-demo-fs';
const STORE = 'files';
const DIRS_KEY = '\u0000dirs';
const dirty = new Set<string>();
const removed = new Set<string>();
let db: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Load the saved demo files. Awaited once before the backend starts. */
export async function loadDemoFs(): Promise<void> {
  db = await openDb();
  if (db) {
    await new Promise<void>((resolve) => {
      const tx = db!.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        if (cur.key === DIRS_KEY) for (const d of cur.value as string[]) dirs.add(d);
        else files.set(String(cur.key), String(cur.value));
        cur.continue();
      };
      req.onerror = () => resolve();
    });
  }
  // One-time move from the older localStorage format.
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      if (!files.size) {
        const data = JSON.parse(raw) as { files: [string, string][]; dirs: string[] };
        for (const [k, v] of data.files) {
          files.set(k, v);
          dirty.add(k);
        }
        for (const d of data.dirs) dirs.add(d);
        persist();
      }
      if (db) localStorage.removeItem(KEY);
    }
  } catch {
    // storage unavailable: the demo still works, it just won't persist
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
function flush() {
  if (!db || (!dirty.size && !removed.size)) return;
  const tx = db.transaction(STORE, 'readwrite');
  const st = tx.objectStore(STORE);
  for (const k of removed) if (!files.has(k)) st.delete(k);
  for (const k of dirty) if (files.has(k)) st.put(files.get(k)!, k);
  st.put([...dirs], DIRS_KEY);
  dirty.clear();
  removed.clear();
}
function persist() {
  clearTimeout(timer);
  timer = setTimeout(flush, 300);
}
function touch(p: string) {
  dirty.add(p);
  removed.delete(p);
}
function drop(p: string) {
  removed.add(p);
  dirty.delete(p);
}
try {
  window.addEventListener('pagehide', flush);
} catch {
  // not in a browser
}

export async function resetDemoFs(): Promise<void> {
  clearTimeout(timer);
  dirty.clear();
  files.clear();
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db!.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export function hasDemoData(): boolean {
  return files.size > 0;
}

class Dirent {
  constructor(
    readonly name: string,
    private dir: boolean,
  ) {}
  isDirectory() {
    return this.dir;
  }
  isFile() {
    return !this.dir;
  }
}

export function existsSync(p: string): boolean {
  const n = norm(p);
  return files.has(n) || dirs.has(n);
}

export const promises = {
  async readFile(p: string): Promise<string> {
    const n = norm(p);
    const v = files.get(n);
    if (v === undefined) throw enoent(n);
    return v;
  },
  async writeFile(p: string, data: string): Promise<void> {
    const n = norm(p);
    addDirs(parent(n));
    files.set(n, String(data));
    touch(n);
    persist();
  },
  async mkdir(p: string): Promise<void> {
    addDirs(norm(p));
    persist();
  },
  async readdir(p: string, opts?: { withFileTypes?: boolean }): Promise<unknown[]> {
    const n = norm(p);
    if (!dirs.has(n)) throw enoent(n);
    const prefix = n === '/' ? '/' : `${n}/`;
    const out = new Map<string, boolean>();
    for (const f of files.keys()) if (f.startsWith(prefix) && !f.slice(prefix.length).includes('/')) out.set(f.slice(prefix.length), false);
    for (const d of dirs) if (d !== n && d.startsWith(prefix) && !d.slice(prefix.length).includes('/')) out.set(d.slice(prefix.length), true);
    const names = [...out.keys()].sort();
    return opts?.withFileTypes ? names.map((k) => new Dirent(k, out.get(k)!)) : names;
  },
  async rename(from: string, to: string): Promise<void> {
    const a = norm(from);
    const b = norm(to);
    if (files.has(a)) {
      addDirs(parent(b));
      files.set(b, files.get(a)!);
      files.delete(a);
      touch(b);
      drop(a);
    } else if (dirs.has(a)) {
      addDirs(b);
      for (const [k, v] of [...files]) if (k.startsWith(`${a}/`)) {
        files.delete(k);
        files.set(b + k.slice(a.length), v);
        drop(k);
        touch(b + k.slice(a.length));
      }
      for (const d of [...dirs]) if (d === a || d.startsWith(`${a}/`)) {
        dirs.delete(d);
        dirs.add(b + d.slice(a.length));
      }
    } else throw enoent(a);
    persist();
  },
  async rm(p: string): Promise<void> {
    const n = norm(p);
    files.delete(n);
    drop(n);
    for (const k of [...files.keys()])
      if (k.startsWith(`${n}/`)) {
        files.delete(k);
        drop(k);
      }
    for (const d of [...dirs]) if (d === n || d.startsWith(`${n}/`)) dirs.delete(d);
    persist();
  },
};

export default { promises, existsSync };
