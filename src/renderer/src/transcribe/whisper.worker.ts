// Runs Whisper (speech to text) on this computer, in a background thread.
// The model is downloaded from Hugging Face the first time and cached; after that it works offline.
import { env, pipeline } from '@huggingface/transformers';
// Bundled with the app (not fetched from a CDN), so transcription works offline.
import mjs from '../../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url';
import wasm from '../../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url';

env.allowLocalModels = false;
const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } };
if (onnx.wasm) onnx.wasm.wasmPaths = { mjs: new URL(mjs, self.location.href).href, wasm: new URL(wasm, self.location.href).href };

type Req = { id: number; model: string; audio: Float32Array; language?: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let asr: any = null;
let loaded = '';

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, model, audio, language } = e.data;
  const post = (m: Record<string, unknown>) => (self as unknown as Worker).postMessage({ id, ...m });
  try {
    if (!asr || loaded !== model) {
      post({ type: 'status', text: 'Loading the speech model…' });
      asr = await pipeline('automatic-speech-recognition', model, {
        progress_callback: (p: { status: string; file?: string; progress?: number; loaded?: number; total?: number }) => {
          if (p.status === 'progress') post({ type: 'download', file: p.file, progress: p.progress ?? 0, loaded: p.loaded, total: p.total });
        },
      });
      loaded = model;
    }
    post({ type: 'status', text: 'Listening…' });
    const englishOnly = /\.en$/.test(model);
    const out = await asr(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
      ...(englishOnly ? {} : { task: 'transcribe', language: language || null }),
    });
    post({ type: 'done', text: out.text, chunks: out.chunks ?? [] });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
