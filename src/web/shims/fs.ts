// In-memory stand-in for node:fs, used only by the browser demo build.
// Files persist to localStorage so a demo vault survives a reload.

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

try {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    const data = JSON.parse(raw) as { files: [string, string][]; dirs: string[] };
    for (const [k, v] of data.files) files.set(k, v);
    for (const d of data.dirs) dirs.add(d);
  }
} catch {
  // storage unavailable: the demo still works, it just won't persist
}

let timer: ReturnType<typeof setTimeout> | undefined;
function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ files: [...files], dirs: [...dirs] }));
    } catch {
      // ignore
    }
  }, 300);
}

export function resetDemoFs() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
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
    } else if (dirs.has(a)) {
      addDirs(b);
      for (const [k, v] of [...files]) if (k.startsWith(`${a}/`)) {
        files.delete(k);
        files.set(b + k.slice(a.length), v);
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
    for (const k of [...files.keys()]) if (k.startsWith(`${n}/`)) files.delete(k);
    for (const d of [...dirs]) if (d === n || d.startsWith(`${n}/`)) dirs.delete(d);
    persist();
  },
};

export default { promises, existsSync };
