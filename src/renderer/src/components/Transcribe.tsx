// Transcription: sermons, lectures, interviews and your own dictation, turned into text.
//   Audio or video file → Whisper on this computer (desktop app; the model downloads once)
//   Record              → the same, from the microphone
//   Dictate             → live, where the system offers speech recognition (Chrome, Edge)
//   Subtitles           → .srt / .vtt files go through the Library importer as timed transcripts
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../state';
import { useDialogs } from './Dialogs';
import { insertText } from '../editor/Editor';
import { WHISPER_MODELS, decodeAudio, transcribe, whisperAvailable, type WhisperProgress } from '../transcribe/whisper';
import { formatTime, toParagraphs, transcriptText, type Segment } from '../../../core/transcript';
import { importToLibrary } from './Library';

type App = ReturnType<typeof useApp>;
type Dialogs = ReturnType<typeof useDialogs>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SpeechRecognitionImpl: any = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
/** Live dictation needs the system's speech service (Chrome and Edge have one; the desktop app does not). */
export const canDictate = !!SpeechRecognitionImpl && !(window as { livingRepo?: unknown }).livingRepo;

export async function openTranscribe(app: App, dialogs: Dialogs, mode: 'file' | 'record' = 'file') {
  await dialogs.show((close) => <TranscribeDialog initialMode={mode} onDone={() => close(null)} />);
  void app;
}

function useModel() {
  const [model, setModel] = useState(() => {
    try {
      return localStorage.getItem('lr.whisper.model') ?? WHISPER_MODELS[0].id;
    } catch {
      return WHISPER_MODELS[0].id;
    }
  });
  const choose = (m: string) => {
    setModel(m);
    try {
      localStorage.setItem('lr.whisper.model', m);
    } catch {
      // ignore
    }
  };
  return [model, choose] as const;
}

function TranscribeDialog({ initialMode, onDone }: { initialMode: 'file' | 'record'; onDone: () => void }) {
  const app = useApp();
  const dialogs = useDialogs();
  const [mode, setMode] = useState(initialMode);
  const [model, setModel] = useModel();
  const [language, setLanguage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [timestamps, setTimestamps] = useState(true);
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [recording, setRecording] = useState<{ rec: MediaRecorder; started: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const chunks = useRef<Blob[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - recording.started) / 1000)), 500);
    return () => clearInterval(t);
  }, [recording]);
  useEffect(() => {
    if (segments) setResult(transcriptText(toParagraphs(segments), { timestamps }).trim());
  }, [segments, timestamps]);

  const run = async (blob: Blob, name: string) => {
    setError(null);
    setResult(null);
    setStatus('Reading the audio…');
    const t0 = Date.now();
    try {
      const audio = await decodeAudio(blob);
      const minutes = audio.length / 16000 / 60;
      setStatus(`Listening to ${minutes < 1 ? 'less than a minute' : `${Math.round(minutes)} minutes`} of audio…`);
      const segs = await transcribe(audio, {
        model,
        language: language || undefined,
        onProgress: (p: WhisperProgress) => {
          if (p.type === 'download') setStatus(`Downloading the speech model (first time only)… ${Math.round(p.progress)}%`);
          else setStatus(`${p.text} ${minutes >= 1 ? `(${Math.round(minutes)} min of audio; this can take a while)` : ''}`);
        },
      });
      setSegments(segs);
      if (!title) setTitle(name);
      setStatus(`Done in ${Math.round((Date.now() - t0) / 1000)} s.`);
    } catch (e) {
      setStatus(null);
      setError((e as Error).message);
    }
  };

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void run(new Blob(chunks.current, { type: rec.mimeType }), `Recording ${new Date().toLocaleString()}`);
      };
      rec.start();
      setRecording({ rec, started: Date.now() });
      setElapsed(0);
    } catch (e) {
      setError(`The microphone could not be opened: ${(e as Error).message}`);
    }
  };
  const stopRecording = () => {
    recording?.rec.stop();
    setRecording(null);
  };

  const save = async (where: 'library' | 'entry' | 'insert') => {
    if (!result) return;
    const name = title.trim() || 'Transcript';
    if (where === 'insert') {
      if (insertText(result)) app.notify('Transcript added to your page');
      else return app.notify('Click into your page first', 'error');
    } else if (where === 'entry') {
      const e = await api.createEntry({ title: name, body: `${result}\n` });
      app.openTab({ kind: 'entry', id: e.id });
    } else {
      const r = await api.importLibrary({ title: name, text: result, kind: 'text', makePage: false });
      if (r.ids[0]) app.openTab({ kind: 'library', id: r.ids[0] });
      app.notify(`Saved “${name}” to the Library`);
    }
    onDone();
  };

  return (
    <div className="import-dialog transcribe-dialog">
      <h2 className="modal-title">Transcribe</h2>
      <div className="seg-tabs">
        <button className={`filter-chip ${mode === 'file' ? 'on' : ''}`} onClick={() => setMode('file')}>
          Audio or video file
        </button>
        <button className={`filter-chip ${mode === 'record' ? 'on' : ''}`} onClick={() => setMode('record')}>
          Record
        </button>
        <button
          className="filter-chip"
          onClick={async () => {
            onDone();
            await importToLibrary(app, dialogs);
          }}
          title="Subtitle files (.srt, .vtt) from YouTube, Otter, Whisper apps and the like"
        >
          Subtitles I already have…
        </button>
      </div>
      {!whisperAvailable && (
        <p className="error">
          Turning audio into text runs a speech model on your computer, so it works in the desktop app, not in this browser demo. Subtitle files (.srt, .vtt) do work here: use “Subtitles I already have”.
        </p>
      )}
      {whisperAvailable && (
        <>
          <p className="muted small">Runs on this computer with Whisper. The first time, the model you choose is downloaded once; after that no internet is needed and nothing leaves your computer.</p>
          <div className="import-grid">
            <label>
              Model
              <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
                {WHISPER_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            {!/\.en$/.test(model) && (
              <label>
                Language
                <select className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
                  <option value="">Work it out</option>
                  <option value="english">English</option>
                  <option value="greek">Greek</option>
                  <option value="latin">Latin</option>
                  <option value="hebrew">Hebrew</option>
                  <option value="spanish">Spanish</option>
                  <option value="german">German</option>
                  <option value="french">French</option>
                </select>
              </label>
            )}
          </div>
          {mode === 'file' ? (
            <div className="drop-zone" role="button" tabIndex={0} onClick={() => input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => (e.preventDefault(), setFile(e.dataTransfer.files[0] ?? null))}>
              {file ? `${file.name} (${(file.size / 1e6).toFixed(1)} MB)` : 'Drop an audio or video file here (MP3, M4A, WAV, OGG, MP4, WebM), or click to choose'}
              <input ref={input} type="file" hidden accept="audio/*,video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
          ) : (
            <div className="record-box">
              {recording ? (
                <>
                  <span className="rec-dot" /> Recording {formatTime(elapsed)}
                  <button className="btn btn-primary" onClick={stopRecording}>
                    ■ Stop and transcribe
                  </button>
                </>
              ) : (
                <button className="btn btn-primary" onClick={startRecording} disabled={!!status && !result && !error}>
                  ● Start recording
                </button>
              )}
            </div>
          )}
        </>
      )}
      {status && <p className="import-progress">{status}</p>}
      {error && <p className="error">{error}</p>}
      {result !== null && (
        <>
          <div className="import-grid">
            <label>
              Title
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="check-row">
              <input type="checkbox" checked={timestamps} onChange={(e) => setTimestamps(e.target.checked)} />
              <span>Keep the times ([00:12:40])</span>
            </label>
          </div>
          <textarea className="input transcript-preview" rows={10} value={result} onChange={(e) => setResult(e.target.value)} />
        </>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={onDone}>
          {result ? 'Discard' : 'Cancel'}
        </button>
        {result ? (
          <>
            <button className="btn" onClick={() => save('insert')}>
              Insert into my page
            </button>
            <button className="btn" onClick={() => save('entry')}>
              New document
            </button>
            <button className="btn btn-primary" onClick={() => save('library')} title="As a read-only source you can file and quote from">
              Save to the Library
            </button>
          </>
        ) : (
          mode === 'file' &&
          whisperAvailable && (
            <button className="btn btn-primary" disabled={!file || (!!status && !error)} onClick={() => file && run(file, file.name.replace(/\.[^.]+$/, ''))}>
              Transcribe
            </button>
          )
        )}
      </div>
    </div>
  );
}

/** Live dictation into the page (browsers with a speech service). Returns a stop function. */
export function startDictation(onText: (text: string) => void, onEnd: (error?: string) => void): () => void {
  const rec = new SpeechRecognitionImpl();
  rec.continuous = true;
  rec.interimResults = false;
  rec.lang = navigator.language || 'en-US';
  rec.onresult = (e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => {
    for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) onText(e.results[i][0].transcript.trim());
  };
  rec.onerror = (e: { error: string }) => onEnd(e.error === 'not-allowed' ? 'Microphone permission was refused.' : e.error);
  rec.onend = () => onEnd();
  rec.start();
  return () => rec.stop();
}
