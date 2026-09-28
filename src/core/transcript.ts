// Transcripts: turn timed speech (subtitle files, or segments from a speech model)
// into readable paragraphs that keep their times, e.g. "[00:12:40] We turn now to…".

export interface Segment {
  /** Seconds from the start. */
  start: number;
  end?: number;
  text: string;
}

const TIME = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?/;

export function parseTime(s: string): number | null {
  const m = TIME.exec(s.trim());
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + (m[4] ? Number(m[4].padEnd(3, '0')) / 1000 : 0);
}

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

const cleanCue = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/^\s*-\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

/** SubRip (.srt) and WebVTT (.vtt) files, and lines starting with a time ("[00:01:05] text", "1:05 text"). */
export function parseSubtitles(text: string): Segment[] | null {
  const t = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  const cues = t.split(/\n{2,}/);
  const out: Segment[] = [];
  const arrow = /((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)/;
  for (const cue of cues) {
    const lines = cue.split('\n');
    const i = lines.findIndex((l) => arrow.test(l));
    if (i < 0) continue;
    const m = arrow.exec(lines[i])!;
    const body = cleanCue(lines.slice(i + 1).join(' '));
    if (body) out.push({ start: parseTime(m[1])!, end: parseTime(m[2]) ?? undefined, text: body });
  }
  if (out.length >= 2) return dedupeRolling(out);
  // Timestamped lines.
  const lineRe = /^\s*\[?((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\]?\s*[-–—:]?\s*(.+)$/;
  const lines = t.split('\n').filter((l) => l.trim());
  for (const l of lines) {
    const m = lineRe.exec(l);
    if (m) out.push({ start: parseTime(m[1])!, text: cleanCue(m[2]) });
    else if (out.length) out[out.length - 1].text += ` ${cleanCue(l)}`;
  }
  return out.length >= 2 && out.length >= lines.length * 0.3 ? out : null;
}

/** Auto-generated captions repeat the previous line as they roll; keep each phrase once. */
function dedupeRolling(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    const prev = out[out.length - 1];
    if (prev && s.text.startsWith(prev.text) && s.text.length > prev.text.length) {
      prev.text = s.text;
      prev.end = s.end;
    } else if (prev && prev.text.endsWith(s.text)) continue;
    else {
      // The new cue repeats the end of the last one: add only the new words.
      const a = prev?.text.split(' ') ?? [];
      const b = s.text.split(' ');
      let k = Math.min(a.length, b.length - 1);
      while (k >= 2 && a.slice(-k).join(' ').toLowerCase() !== b.slice(0, k).join(' ').toLowerCase()) k--;
      if (prev && k >= 2) {
        prev.text = `${prev.text} ${b.slice(k).join(' ')}`;
        prev.end = s.end;
      } else out.push({ ...s });
    }
  }
  return out;
}

/** Join segments into paragraphs: a new one after a pause, or when a paragraph grows long. */
export function toParagraphs(segs: Segment[], opts: { pause?: number; maxSeconds?: number; maxWords?: number } = {}): Segment[] {
  const pause = opts.pause ?? 2;
  const maxSeconds = opts.maxSeconds ?? 75;
  const maxWords = opts.maxWords ?? 140;
  const out: Segment[] = [];
  let cur: Segment | null = null;
  for (const s of segs) {
    const words = cur ? cur.text.split(/\s+/).length : 0;
    const gap = cur?.end !== undefined ? s.start - cur.end : 0;
    const endsSentence = cur ? /[.!?]["”’)]?$/.test(cur.text) : false;
    const long = cur ? s.start - cur.start >= maxSeconds || words >= maxWords : false;
    if (!cur || gap >= pause || (long && endsSentence) || words >= maxWords * 1.6) {
      if (cur) out.push(cur);
      cur = { start: s.start, end: s.end, text: s.text };
    } else {
      cur.text = `${cur.text} ${s.text}`.replace(/\s+/g, ' ').trim();
      cur.end = s.end ?? cur.end;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Plain text for the Library importer or a new document: one timed paragraph per block. */
export function transcriptText(paras: Segment[], opts: { timestamps?: boolean; title?: string } = {}): string {
  const body = paras.map((p) => (opts.timestamps === false ? p.text : `[${formatTime(p.start)}] ${p.text}`)).join('\n\n');
  return opts.title ? `# ${opts.title}\n\n${body}\n` : `${body}\n`;
}

/** Does this file look like subtitles or a timed transcript? */
export function isTranscriptFile(name: string, text: string): boolean {
  if (/\.(srt|vtt|sbv)$/i.test(name)) return true;
  return /^WEBVTT/.test(text.trimStart()) || /^\d+\s*\n\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(text.trimStart());
}
