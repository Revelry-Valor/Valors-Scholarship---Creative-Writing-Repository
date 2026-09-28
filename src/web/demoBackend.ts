// Runs the real backend and engine inside the page, over the in-memory file system.
import { Backend, type BackendEvent } from '../backend/backend';
import { Vault } from '../core/vault';
import { hasDemoData, resetDemoFs } from './shims/fs';

const VAULT = '/home/you/Documents/Living Repository/Scholarship';

async function seed() {
  const v = await Vault.create(VAULT, { name: 'Scholarship', pack: 'scholarship', author: 'you' });
  await v.createEntity({ name: 'On the Vine', type: 'work' });
  await v.createEntity({ name: 'Northern Province', type: 'place' });
  await v.createEntity({ name: 'Chamberlain Pineapple', type: 'church-father' });
  const s = await v.createEntity({ name: 'Apple Scouch', type: 'church-father' });
  await v.updateEntity(s.id, { aliases: ['the Vine Doctor'], fields: { born: 'c. 1280', region: '@Northern Province' } });

  const start = await v.createEntry({ title: 'Start here' });
  await v.saveEntry(
    start.id,
    `This is a sample project so you can try things. Your changes are saved in this browser only.

## Things to try

- Put the cursor at the end of this line and type \`@\` to open the menu. Pick "Create new…" and invent a person.
- On a new line, type \`@Scouch\` and a sentence. Watch the coloured stripe appear in the margin: that paragraph now lives on Apple Scouch's profile too.
- After a tag, type \`{\` to set a fact from that person's template, like when they were born.
- Open "Early Church Fathers — overview" in the binder, then open Apple Scouch's profile from the Entities list. Click a paragraph there and edit it; the change shows up in the entry.
- Press Ctrl+O to jump anywhere, Ctrl+K for every command, and F1 for the markup cheat sheet.
- Delete a whole paragraph that is filed to a profile, and you'll be asked before it disappears from those pages.
`,
  );

  const e = await v.createEntry({ title: 'Early Church Fathers — overview' });
  await v.saveEntry(
    e.id,
    `## Apple Scouch @

@Apple Scouch wrote @On the Vine in {year: 1313}, arguing that grace precedes repentance (cf. Eph 2:8–9).

He taught in the northern province for most of his life, and his students remembered him as a gentle but stubborn teacher. %% check the dates in Harlow %%

@Chamberlain Pineapple studied under him before breaking with his theology.

### Pineapple's objections @Chamberlain Pineapple

He argued repentance must come first, citing Acts 2:38. @Chamberlain Pineapple {died: 1351}

@Chamberlain Pineapple >disagrees_with> @Apple Scouch on #grace-and-repentance, citing Acts 2:38.

## Later reception

For a century after their deaths, few writers mentioned either man.
`,
  );
  const f = await v.createFolder({ name: 'Thesis' });
  const ch = await v.createEntry({ title: 'Chapter 1 — Grace', parent: { kind: 'folder', path: f } });
  await v.createEntry({ title: 'Section 1.1', parent: { kind: 'entry', id: ch.id }, body: 'Was @Scouch right about grace? This section weighs his reading of Ephesians.\n' });
  await v.createEntry({ title: 'Section 1.2', parent: { kind: 'entry', id: ch.id }, body: 'A short look at the Vine treatise and its first readers.\n' });
  return start.id;
}

const backend = new Backend('/home/you/.config/living-repository');
const listeners = new Set<(e: BackendEvent) => void>();
backend.onEvent((e) => listeners.forEach((fn) => fn(e)));

const ready = (async () => {
  await backend.init();
  if (!hasDemoData() || !Vault.isVault(VAULT)) {
    const startId = await seed();
    await backend.methods.setAuthor('you');
    await backend.methods.openVault(VAULT);
    try {
      localStorage.setItem(`lr.tabs.${VAULT}`, JSON.stringify({ tabs: [{ key: `entry:${startId}`, kind: 'entry', id: startId }], active: `entry:${startId}` }));
    } catch {
      // ignore
    }
  } else {
    await backend.restoreLastVault();
  }
})();

window.__lrBackend = {
  ready,
  call: async (method: string, args: unknown[]) => {
    await ready;
    try {
      return { ok: true, value: await backend.call(method, args) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
  onEvent: (fn: (e: BackendEvent) => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  reset: () => {
    resetDemoFs();
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('lr.')) localStorage.removeItem(k);
    } catch {
      // ignore
    }
    location.reload();
  },
};
