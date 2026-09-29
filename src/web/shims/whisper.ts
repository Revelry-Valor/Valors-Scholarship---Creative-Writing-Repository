// The browser demo cannot download speech models; transcription needs the desktop app.
import type { Segment } from '../../core/transcript';

export const WHISPER_MODELS = [{ id: 'none', label: 'Available in the desktop app' }];
export const whisperAvailable = false;
export type WhisperProgress = { type: 'status'; text: string };
export async function decodeAudio(): Promise<Float32Array> {
  throw new Error('Transcribing audio needs the desktop app.');
}
export async function transcribe(): Promise<Segment[]> {
  throw new Error('Transcribing audio needs the desktop app.');
}
