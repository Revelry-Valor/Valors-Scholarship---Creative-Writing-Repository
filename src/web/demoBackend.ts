// Runs the real backend and engine inside the page, over the in-memory file system.
import { Backend, type BackendEvent } from '../backend/backend';
import { Vault } from '../core/vault';
import { hasDemoData, loadDemoFs, resetDemoFs } from './shims/fs';

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
- Format like a word processor: the toolbar above the page has paragraph styles, fonts, text size, **bold**, *italic*, lists and ==highlights==. Ctrl+B, Ctrl+I and Ctrl+U work too. Enter starts a new paragraph; Shift+Enter breaks a line.
- Open "Page ▾" in the toolbar for line spacing, book-style indented paragraphs, justified text and page width.
- Open the topic "prophecies regarding the jews" under Entities. It gathers paragraphs from two documents and keeps each document's paragraphs together, in order.
- Profiles are pages you write on: open Apple Scouch and type under "Life". Paragraphs written elsewhere appear under their heading. A heading you add becomes a new section.
- Family facts link both ways: after a tag, type { and choose mother, children, friends… Pineapple lists Scouch as a teacher, so Scouch's page lists Pineapple as a student.
- Mark important details: put the cursor in a paragraph and press ★ Important (Ctrl+Shift+K), or select a few words first to mark just them. ⚑ marks something to check later. Marked details appear at the top of each person's page and under ★ Key details in the top bar.
- Press Ctrl+O to jump anywhere. "Commands ▾" and "? Guide" in the top bar list every command and all the markup.
- Delete a whole paragraph that is filed to a profile, and you'll be asked before it disappears from those pages.
`,
  );

  const e = await v.createEntry({ title: 'Early Church Fathers — overview' });
  await v.saveEntry(
    e.id,
    `## Apple Scouch @

@Apple Scouch wrote @On the Vine in {year: 1313}, arguing that grace precedes repentance (cf. Eph 2:8–9). !key

He taught in the northern province for most of his life, and his students remembered him as a !!gentle but stubborn!! teacher. %% check the dates in Harlow %%

@Chamberlain Pineapple {teachers: @Apple Scouch} studied under him before breaking with his theology.

### Pineapple's objections @Chamberlain Pineapple

He argued repentance must come first, citing Acts 2:38. @Chamberlain Pineapple {died: 1351}

@Chamberlain Pineapple >disagrees_with> @Apple Scouch on #grace-and-repentance, citing Acts 2:38.

## Later reception

For a century after their deaths, few writers mentioned either man.
`,
  );
  // One concept gathered from two documents (the topic page keeps each document's paragraphs together).
  const said = await v.createEntry({ title: 'What the prophets said' });
  await v.saveEntry(
    said.id,
    `## Isaiah

Isaiah 53 describes a servant who is "despised and rejected", and early Christian readers took it as a prophecy of Christ. #prophecies-regarding-the-jews

## Micah

Micah 5:2 names Bethlehem as the birthplace of a coming ruler. #prophecies-regarding-the-jews
`,
  );
  const did = await v.createEntry({ title: 'At the crucifixion' });
  await v.saveEntry(
    did.id,
    `The gospel writers point back to Psalm 22 when they describe the soldiers casting lots for his clothing. #prophecies-regarding-the-jews

Matthew connects the thirty pieces of silver to Zechariah 11. #prophecies-regarding-the-jews
`,
  );
  const f = await v.createFolder({ name: 'Thesis' });
  const ch = await v.createEntry({ title: 'Chapter 1 — Grace', parent: { kind: 'folder', path: f } });
  await v.createEntry({ title: 'Section 1.1', parent: { kind: 'entry', id: ch.id }, body: 'Was @Scouch right about grace? This section weighs his reading of Ephesians.\n' });
  await v.createEntry({ title: 'Section 1.2', parent: { kind: 'entry', id: ch.id }, body: 'A short look at the Vine treatise and its first readers.\n' });
  return start.id;
}

const WORLD = '/home/you/Documents/Living Repository/The Old Empire';

async function seedWorld() {
  const v = await Vault.create(WORLD, { name: 'The Old Empire', pack: 'fantasy', author: 'you' });
  const make = async (names: string[], type: string) => {
    for (const name of names) await v.createEntity({ name, type });
  };
  await make(['Old King Harwin', 'King Aldric', 'Queen Mera', 'Prince Tomas', 'Princess Lena', 'Sera of Carrow', 'Kael'], 'character');
  await make(['Varenhold', 'Carrow', 'Iron Coast'], 'faction');
  await make(['Carrow Keep', 'Saltmere'], 'settlement');
  await make(['Humans', 'Veyl'], 'race');
  await make(['Zeryth', 'Ilura'], 'religion');
  await make(['Bronze working', 'Carpentry', 'Ironworking', 'Steel', 'Siege engines', 'Sailing', 'Deep-sea navigation'], 'technology');
  await make(['Emberthorn'], 'flora');
  await make(['Ash wolf', 'Grey hare'], 'fauna');

  const start = await v.createEntry({ title: 'Start here' });
  await v.saveEntry(
    start.id,
    `A sample world for trying the charts. Everything under Timelines & Trees in the sidebar is drawn from the documents here; nothing in the charts was typed by hand.

- Open "House Aldric" to see how family facts are written, then the "Family of King Aldric" tree.
- "Varenhold and its neighbours" puts one nation in the centre. Hover a line to see the sentence behind it; click it to jump there.
- "The gods" is a relationship web: Zeryth despises Ilura, but Ilura admires Zeryth, so there are two arrows of different colours.
- The tech tree comes from "requires" facts, the food chain from "eats" facts, the timeline from every date.
- Add your own with the + next to Timelines & Trees. New types (Settlement, Flora, Fauna…) come from the ⊕ next to Entities.
`,
  );
  const house = await v.createEntry({ title: 'House Aldric' });
  await v.saveEntry(
    house.id,
    `## The royal line

@Old King Harwin {born: 342} {died: 399} built the first walls of the capital.

@King Aldric {born: 380} {died: 441} {father: @Old King Harwin} {spouse: @Queen Mera} ruled @Varenhold for thirty years.

@Queen Mera {born: 384} {died: 450} came from @Saltmere on the @Iron Coast.

@Prince Tomas {born: 405} {father: @King Aldric} {mother: @Queen Mera} {spouse: @Sera of Carrow} was the elder child and a reluctant soldier.

@Princess Lena {born: 409} {father: @King Aldric} {mother: @Queen Mera} {friends: @Sera of Carrow} preferred the library to the court.

@Kael {born: 430} {father: @Prince Tomas} {mother: @Sera of Carrow} would inherit a divided realm. !check
`,
  );
  const wars = await v.createEntry({ title: 'The wars of the north' });
  await v.saveEntry(
    wars.id,
    `In {year: 412} @King Aldric of @Varenhold besieged @Carrow Keep, and after three months it fell. !key

@Varenhold >enemy_of> @Carrow from the siege onward, and @Varenhold {vassals: @Carrow} by {year: 420}.

@Iron Coast >allied_with> @Varenhold through the queen's family.

@Carrow >despises> @Iron Coast for its fleets, yet @Iron Coast >admires> @Carrow for its scholars.

@Zeryth >despises> @Ilura, while @Ilura >admires> @Zeryth and waits for him to relent.

@Varenhold >worships> @Zeryth; @Carrow >worships> @Ilura.
`,
  );
  const tech = await v.createEntry({ title: 'How the north learned' });
  await v.saveEntry(
    tech.id,
    `@Bronze working {discovered: 120} came first, then @Sailing {discovered: 150}.

@Ironworking {requires: @Bronze working} {discovered: 260} changed farming as much as war.

@Steel {requires: @Ironworking} {discovered: 390} and @Siege engines {requires: @Ironworking, @Carpentry} made the siege of 412 possible.

@Deep-sea navigation {requires: @Sailing, @Steel} let the @Iron Coast reach the far islands.

## Wild things

@Ash wolf {eats: @Grey hare} hunts the high moors, and @Grey hare {eats: @Emberthorn} strips the hedges bare each spring.
`,
  );
  const aldric = [...v.entities.values()].find((e) => e.name === 'King Aldric')!.id;
  const varenhold = [...v.entities.values()].find((e) => e.name === 'Varenhold')!.id;
  await v.createView({ name: 'Family of King Aldric', kind: 'family', root: aldric });
  await v.createView({ name: 'Varenhold and its neighbours', kind: 'radial', root: varenhold });
  const gods = await v.createView({ name: 'The gods', kind: 'web' });
  await v.saveView({ ...gods, types: ['religion'] });
  await v.createView({ name: 'Tech tree', kind: 'tech' });
  const food = await v.createView({ name: 'Food chain', kind: 'lineage' });
  await v.saveView({ ...food, relation: 'eats' });
  await v.createView({ name: 'History of the realm', kind: 'timeline' });
  return start.id;
}

async function addScholarshipViews() {
  const v = await Vault.open(VAULT, { author: 'you' });
  if ((await v.listViews()).length) return;
  await v.createView({ name: 'Church history', kind: 'timeline' });
  const t = await v.createView({ name: 'Teachers and students', kind: 'lineage' });
  await v.saveView({ ...t, relation: 'teacher' });
}

const backend = new Backend('/home/you/.config/living-repository');
const listeners = new Set<(e: BackendEvent) => void>();
backend.onEvent((e) => listeners.forEach((fn) => fn(e)));

const ready = (async () => {
  await loadDemoFs();
  await backend.init();
  // The fantasy sample is added alongside, so an existing Scholarship sample keeps your changes.
  if (!Vault.isVault(WORLD)) {
    try {
      const worldStart = await seedWorld();
      localStorage.setItem(`lr.tabs.${WORLD}`, JSON.stringify({ tabs: [{ key: `entry:${worldStart}`, kind: 'entry', id: worldStart }], active: `entry:${worldStart}` }));
    } catch {
      // ignore: the demo still works without the second sample
    }
  }
  if (Vault.isVault(WORLD) && !backend.config.recent.some((r) => r.path === WORLD)) {
    backend.config.recent.push({ path: WORLD, name: 'The Old Empire', openedAt: new Date().toISOString() });
  }
  if (!hasDemoData() || !Vault.isVault(VAULT)) {
    const startId = await seed();
    await addScholarshipViews().catch(() => undefined);
    await backend.methods.openVault(WORLD).catch(() => undefined);
    await backend.methods.setAuthor('you');
    await backend.methods.openVault(VAULT);
    try {
      localStorage.setItem(`lr.tabs.${VAULT}`, JSON.stringify({ tabs: [{ key: `entry:${startId}`, kind: 'entry', id: startId }], active: `entry:${startId}` }));
    } catch {
      // ignore
    }
  } else {
    await addScholarshipViews().catch(() => undefined);
    await backend.restoreLastVault();
    // Sample projects made by an earlier version get the newer starter facts.
    if (backend.vault) await backend.methods.upgradeTemplates().catch(() => undefined);
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
  reset: async () => {
    await resetDemoFs();
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('lr.')) localStorage.removeItem(k);
    } catch {
      // ignore
    }
    location.reload();
  },
};
