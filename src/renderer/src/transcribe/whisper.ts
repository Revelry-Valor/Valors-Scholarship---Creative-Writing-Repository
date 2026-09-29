// Speech to text on this computer (desktop app). See whisper.worker.ts.
import type { Segment } from '../../../core/transcript';

export const WHISPER_MODELS = [
  { id: 'Xenova/whisper-tiny.en', label: 'Fast (English, about 40 MB)' },
  { id: 'Xenova/whisper-base.en', label: 'Better (English, about 80 MB)' },
  { id: 'Xenova/whisper-small', label: 'Best, many languages incl. Greek (about 250 MB)' },
];

export const whisperAvailable = true;

export type WhisperProgress = { type: 'status'; text: string } | { type: 'download'; file?: string; progress: number; loaded?: number; total?: number };

let worker: Worker | null = null;
let seq = 0;

/** Decode any audio or video file the browser can play, as 16 kHz mono. */
export async function decodeAudio(blob: Blob): Promise<Float32Array> {
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (buf.numberOfChannels === 1) return buf.getChannelData(0);
    const a = buf.getChannelData(0);
    const b = buf.getChannelData(1);
    const out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) / 2;
    return out;
  } finally {
    void ctx.close();
  }
}

export function transcribe(audio: Float32Array, opts: { model: string; language?: string; onProgress?: (p: WhisperProgress) => void }): Promise<Segment[]> {
  worker ??= new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  const id = ++seq;
  const w = worker;
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === 'done') {
        w.removeEventListener('message', onMsg);
        const chunks = (m.chunks as Array<{ timestamp: [number, number | null]; text: string }>).filter((c) => c.text.trim());
        resolve(chunks.length ? chunks.map((c) => ({ start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? undefined, text: c.text.trim() })) : [{ start: 0, text: String(m.text).trim() }]);
      } else if (m.type === 'error') {
        w.removeEventListener('message', onMsg);
        reject(new Error(/fetch|network|Failed to load/i.test(m.message) ? `Could not download the speech model (${m.message}). The first use needs an internet connection; after that it works offline.` : m.message));
      } else opts.onProgress?.(m);
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ id, model: opts.model, audio, language: opts.language }, [audio.buffer]);
  });
}
