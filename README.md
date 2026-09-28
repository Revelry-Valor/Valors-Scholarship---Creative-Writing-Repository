# Living Repository

A writing environment for writers and scholars. You write naturally in one place; the program recognizes the people, places, topics and works you mention, files each paragraph onto their profile pages, and keeps every profile up to date from what you wrote — so nothing is ever recorded twice.

This repository is the **Phase 1 (Core)** build of the *Living Repository — Program Specification*.

## Running it

Requires Node.js 22+.

```bash
npm install
npm run dev        # desktop app (Electron) with hot reload
npm test           # engine + acceptance tests
npm run dist:win   # Windows installer (run on Windows) → release/
npm run web        # the same UI in a browser at http://localhost:5199 (development / testing)
```

On first launch you get the **project picker**: create a vault from a starter pack (Scholarship, Fantasy world or Blank) or open an existing vault folder.

## Using it

| Do this | Result |
| --- | --- |
| Type `@` | One menu for everything: link an existing entity, create a new one, add a fact, record a relationship, tag a topic |
| Type `@Tertullian` and pick *Create “Tertullian” as Church Father* | Profile created in `entities/people/`, paragraph filed to it |
| Write `## Apple Scouch @` | Every paragraph under that heading is filed to Apple Scouch until the next `##` |
| Write `@Pineapple >disagrees_with> @Scouch` | Relationship recorded once, shown on both profiles ("Disagrees with" / "Disagreed with by") |
| Type `{` after a tag | Field picker with that entity's template fields |
| Open a profile | Fact box, template sections filled with your paragraphs, relationships, timeline strip, mentions |
| Click a paragraph on a profile | Edit it in place — the change is saved to the entry it lives in and appears everywhere |
| Delete a paragraph that is on other pages | "This block appears on 3 pages" — delete everywhere, I'm moving it, or restore |

**Timelines & Trees** (sidebar) are saved charts drawn from what you wrote — never typed by hand:

| Chart | Drawn from |
| --- | --- |
| Timeline | every date: born/died life spans, dated facts, `{year: …}` paragraphs; lanes per type or per entity |
| Family tree | `{father: @…}`, `{mother: @…}`, `{children: @A, @B}`, `{spouse: @…}`, `>parent_of>`; spouses side by side |
| Lineage tree | any chain: teacher → student, overlord → vassal, food chain, or any relationship type |
| Tech tree | Technology pages' `requires` / `leads to` facts |
| Radial chart | one nation or person in the centre, everyone linked to them around it, coloured by kind; one-sided feelings are two arrows |
| Relationship web | everyone of the chosen types on a circle, with who is what to whom |

Types available to any project (⊕ next to Entities): Settlement, Race, Species, Flora, Fauna, Technology, plus every starter type and your own. Family, allies/enemies, vassals, predator/prey and requires/leads-to facts are two-way.

The coloured **context stripe** in the left margin shows, for every paragraph, which profiles it will be filed to (one colour per entity; hover for names). The **This block** panel on the right spells it out and offers one-click fixes for broken markup.

**Keys:** `Ctrl+O` go to anything · `Ctrl+K` commands · `Ctrl+N` new document · `Ctrl+Shift+E` new entity · `Ctrl+Shift+F` search · `F1` markup reference (pinnable) · `Ctrl+E` raw markup · `Ctrl+Enter` / `Ctrl+click` open the chip under the cursor · `Ctrl+\` right panel · `Ctrl+W` / `Ctrl+Tab` tabs. Everything is reachable without the mouse.

## Technology choice (spec §20: "explain the choice before building")

| Need (spec §13) | Choice | Why |
| --- | --- | --- |
| Local-first Windows desktop app, installer, auto-update | **Electron** + electron-builder (NSIS) | Mature Windows installer and update story; ships its own Chromium, so the editor behaves identically on every PC |
| Live chips inside the text, over Markdown | **CodeMirror 6** | The document *is* the Markdown file, so chips are decorations over plain text rather than a separate rich-text model — the file on disk stays exactly what you typed. Autocomplete, gutters and atomic ranges cover the `@` menu, context stripe and hidden block ids |
| One engine for app, editor and tests | **TypeScript** throughout | The markup parser and filing rules in `src/core` run in the editor (for chips and the stripe while you type) *and* in the indexer, so what you see is always what gets filed |
| Fast index, safe to delete | **In-memory index** built from the files | Measured: 10,000 blocks re-index in under 1 second (spec asks for < 30 s). Nothing needs persisting, so `.index/` is trivially safe to delete. A SQLite cache can be added behind the same interface if vaults grow far beyond the spec's targets |
| UI | **React** | Views (profiles, binder, panels) are plain components over the view models in `src/core/views.ts` |

## Where things live

```
src/core/        the engine — no UI, no Electron; fully unit-tested
  markup.ts        inline markup tokenizer (@, @@, [[ ]], { }, >rel>, #topic, ^pin, %% %%)
  document.ts      frontmatter, splitting files into blocks, permanent block ids
  analysis.ts      filing rules: inline tags, section owners (§4.3), opt-outs, fields, relationships, warnings
  templates.ts     entity types with inheritance, relationship types, starter packs
  vault.ts         the vault on disk + index: entries, entities, binder, rename, external edits
  meta.ts          block authorship and edit history (§18.5)
  views.ts         profile pages, quick switcher, full-text search
src/backend/     one method table exposed to the UI (IPC in Electron, HTTP in browser mode)
src/main/        Electron main process          src/preload/  the IPC bridge
src/renderer/    React UI; src/renderer/src/editor/ holds the CodeMirror extensions
tests/           markup unit tests + spec acceptance tests
```

### A vault on disk

```
Scholarship/
  entries/            your writing; nested folders, and "Chapter 1.md" + "Chapter 1/" for sub-documents
  entities/people/    one .md per entity: frontmatter (id, type, name, aliases, fields) + notes written on the profile
  templates/          one .yaml per type — edit these (or use the template editor) to add facts and sections
  views/              saved timelines and trees (settings only)
  relations.yaml      relationship types with inverse labels and categories
  settings.yaml       vault settings (default type, last used type, …)
  binder.yaml         manual order of the binder
  .meta/blocks/       authorship + edit history for every block (keep this)
  .index/             generated; safe to delete
  .trash/             deleted documents and profiles, recoverable
```

Every block ends with a hidden permanent id (`^b-4x9k2q`) so profiles, history and links survive edits, moves and renames. Open any file in Notepad and it reads as ordinary Markdown.

## Phase 1 status

Acceptance tests from spec §14 that are automated in `tests/acceptance.phase1.test.ts` and passing:

| Test | Covers |
| --- | --- |
| T1 | `@@Name` creates a profile in `entities/people/`, block listed under Mentions |
| T6 | Relationship stored once, both sides with inverse labels, same block |
| T7 | Editing a block from a profile updates the entry and the other profile; history kept |
| T8 | Delete reports every page a block is on; "remove tag for this page" handled via opt-out or untagging |
| T9 | Section heading files paragraphs until the next `##` |
| T14 | Rename rewrites tags, links, fields and heading tags in every file; old name kept as alias |
| T19 | Deleting `.index/` and reopening gives byte-identical profiles |
| T20 | A file edited outside the program is re-indexed (the app watches the vault folder) |
| T24–T26 | Several people in one section: inline `@@`, shared sub-headings, `@-Name` opt-out |
| T39 | "Add a fact" offers the last tagged entity's template fields |
| T41 | Binder nesting, drag-to-reorder saved, word counts total their children |
| T52 | Every block stores author, created time, history and status *approved* |

Also covered: quick switcher and full-text search, facts from `{field: value}` with disputed values, direct notes on profiles, and a 10,000-block rebuild benchmark. T40 (F1 panel, pinnable) is UI-only and was verified by hand along with the other UI flows.

### Decisions worth knowing

- **Multi-word names.** `@Apple Scouch wrote…` is read by longest known name first, then a run of capitalized words (with particles like *of*, *de*: `@Council of Nicaea`). Anything unusual uses brackets: `@[grace and repentance|this doctrine]`. The editor writes the right form for you.
- **Short names.** `@Pineapple` resolves to *Chamberlain Pineapple* when exactly one entity has that word in its name. Ambiguous names get a warning instead of a guess.
- **`#topic`** creates a Topic entity on save if it doesn't exist, like `@@`.
- **Section rules.** A tagged block with no `::Section` goes to the section whose name matches the heading it sits under (e.g. `### Writings`), then to the template's rules (e.g. conflict relationships → *Disagreements*, blocks that also tag a Work → *Writings*), otherwise to *Mentions*.
- **Deleting** documents and profiles moves them to `.trash/` rather than erasing them.

## Next (Phase 2)

Scripture detection and chapter pages, the Library importer with its review queue, timelines and timeline documents, citations, the gaps dashboard, open questions, confidence levels, the glossary, attachments and snapshots.
