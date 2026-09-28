// Renders a block's markup as reading text with chips (used on profiles and in search).
import type { ReactNode } from "react";
import { tokenize } from "../../../core/markup";
import { useApp } from "../state";

function inlineMarkdown(text: string, keyBase: string): ReactNode[] {
  // **bold**, *italic*, `code` — enough for reading views.
  const out: ReactNode[] = [];
  const re =
    /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|~~[^~\n]+~~|==[^=\n]+==|<u>.*?<\/u>)/g;
  let last = 0;
  let i = 0;
  for (let m; (m = re.exec(text)); ) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const s = m[0];
    const k = `${keyBase}-${i++}`;
    if (s.startsWith("**")) out.push(<strong key={k}>{s.slice(2, -2)}</strong>);
    else if (s.startsWith("`")) out.push(<code key={k}>{s.slice(1, -1)}</code>);
    else if (s.startsWith("~~")) out.push(<s key={k}>{s.slice(2, -2)}</s>);
    else if (s.startsWith("=="))
      out.push(<mark key={k}>{s.slice(2, -2)}</mark>);
    else if (s.startsWith("<u>")) out.push(<u key={k}>{s.slice(3, -4)}</u>);
    else out.push(<em key={k}>{s.slice(1, -1)}</em>);
    last = m.index + s.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * `highlights` are [from, to] ranges in `text` to mark (search hits, scan matches).
 */
export function BlockText({
  text,
  onOpenEntity,
  highlights,
}: {
  text: string;
  onOpenEntity?: (id: string) => void;
  highlights?: Array<[number, number]>;
}) {
  const app = useApp();
  const open =
    onOpenEntity ?? ((id: string) => app.openTab({ kind: "entity", id }));
  let body = text.replace(/^#{1,6}\s+/, "");
  const isList = /^(?:[-*+]|\d+[.)])\s/.test(body);
  const isQuote = /^>\s?/.test(body);
  if (isList) body = body.replace(/^(?:[-*+]|\d+[.)])\s/, "");
  // Highlights are given against the raw text; shift them past a removed prefix.
  const shift = text.length - body.length;
  if (isQuote) body = body.replace(/^>\s?/gm, "");
  const spans = (isQuote ? [] : (highlights ?? []))
    .map(([a, b]) => [a - shift, b - shift] as [number, number])
    .filter(([, b]) => b > 0)
    .sort((a, b) => a[0] - b[0]);
  const tokens = tokenize(body, app.names);
  const parts: ReactNode[] = [];
  let last = 0;
  const lines = (s: string, k: string) => {
    s.split("\n").forEach((line, i) => {
      if (i) parts.push(<br key={`${k}-br${i}`} />);
      parts.push(...inlineMarkdown(line, `${k}-${i}`));
    });
  };
  const plain = (s: string, k: string, start = last) => {
    if (!spans.length) return lines(s, k);
    let at = start;
    const end = start + s.length;
    spans.forEach(([a, b], j) => {
      if (b <= at || a >= end) return;
      if (a > at) lines(body.slice(at, a), `${k}-a${j}`);
      const to = Math.min(b, end);
      parts.push(
        <mark key={`${k}-h${j}`} className="hit">
          {body.slice(Math.max(a, at), to)}
        </mark>,
      );
      at = to;
    });
    if (at < end) lines(body.slice(at, end), `${k}-z`);
  };
  const hitToken = (from: number, to: number) =>
    spans.some(([a, b]) => a < to && b > from);
  tokens.forEach((t, i) => {
    if (t.from > last) plain(body.slice(last, t.from), `p${i}`, last);
    last = t.to;
    const key = `t${i}`;
    const before = parts.length;
    (() => {
      switch (t.kind) {
        case "tag": {
          if (t.bare) return;
          const r = app.names.resolve(t.name);
          const e = r.status === "ok" ? app.entityById.get(r.id) : undefined;
          if (t.optOut) return;
          parts.push(
            <button
              key={key}
              className={`chip ${e ? "" : "chip-missing"}`}
              style={{ ["--chip" as string]: e?.color ?? "var(--danger)" }}
              title={e ? `${e.name} · ${e.typeName}` : `No entity "${t.name}"`}
              onClick={() => e && open(e.id)}
            >
              {t.display ?? t.name}
            </button>,
          );
          return;
        }
        case "topic": {
          const r = app.names.resolve(t.name);
          const e = r.status === "ok" ? app.entityById.get(r.id) : undefined;
          parts.push(
            <button
              key={key}
              className="chip chip-topic"
              style={{ ["--chip" as string]: e?.color ?? "var(--accent)" }}
              onClick={() => e && open(e.id)}
            >
              #{t.name}
            </button>,
          );
          return;
        }
        case "link": {
          const r = app.names.resolve(t.name);
          const e = r.status === "ok" ? app.entityById.get(r.id) : undefined;
          parts.push(
            <button
              key={key}
              className="link-chip"
              onClick={() => e && open(e.id)}
              title={e ? `${e.name} (link)` : "No such entity"}
            >
              {t.display ?? t.name}
            </button>,
          );
          return;
        }
        case "field":
          parts.push(
            <span
              key={key}
              className="badge badge-field"
              title={`${t.entity ? `${t.entity}.` : ""}${t.field}`}
            >
              {t.value.replace(/^@+/, "")}
            </span>,
          );
          return;
        case "relation": {
          const def = app.relationTypes.get(t.type);
          parts.push(
            <span key={key} className="badge badge-rel">
              {def?.label.toLowerCase() ?? t.type.replace(/_/g, " ")}
            </span>,
          );
          return;
        }
        case "code":
          parts.push(<code key={key}>{body.slice(t.from + 1, t.to - 1)}</code>);
          return;
        case "scripture":
          parts.push(
            <span
              key={key}
              className={`scripture-ref ${t.ref.quoted ? "quoted" : ""}`}
              title={`${t.ref.label}${t.ref.quoted ? " · quoted" : ""}${t.ref.compare ? " · compare" : ""}`}
            >
              {body.slice(t.from, t.to)}
            </span>,
          );
          return;
        case "keyspan":
          parts.push(
            <strong key={key} className="key-phrase" title="Marked important">
              {t.inner}
            </strong>,
          );
          return;
        case "mark":
          parts.push(
            <span key={key} className={`badge mark-badge mark-${t.mark}`}>
              {t.mark === "key" ? "★ Important" : "⚑ Check this"}
            </span>,
          );
          return;
        default:
          return; // notes, pins and ids are never shown on views
      }
    })();
    if (parts.length > before && hitToken(t.from, t.to)) {
      const made = parts.splice(before);
      parts.push(
        <mark key={`${key}-hit`} className="hit">
          {made}
        </mark>,
      );
    }
  });
  if (last < body.length) plain(body.slice(last), "end", last);
  const cls = `block-text${isList ? " block-list" : ""}${isQuote ? " block-quote" : ""}`;
  return <div className={cls}>{parts}</div>;
}
