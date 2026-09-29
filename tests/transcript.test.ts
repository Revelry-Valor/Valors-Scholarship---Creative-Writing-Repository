import { describe, expect, it } from 'vitest';
import { formatTime, isTranscriptFile, parseSubtitles, parseTime, toParagraphs, transcriptText } from '../src/core/transcript';

const SRT = `1
00:00:01,000 --> 00:00:03,500
Grace and peace to you.

2
00:00:03,600 --> 00:00:07,000
Today we read from the <i>Shepherd of Hermas</i>.

3
00:00:12,000 --> 00:00:15,000
Eusebius places it among the rejected writings.

4
00:00:15,100 --> 00:00:18,000
Athanasius says it may be read.
`;

const VTT = `WEBVTT

00:00.000 --> 00:02.000
the canon was not

00:01.500 --> 00:04.000
the canon was not fixed at once

00:04.000 --> 00:06.000
fixed at once but grew over time
`;

describe('transcripts', () => {
  it('reads times', () => {
    expect(parseTime('00:01:05,250')).toBeCloseTo(65.25);
    expect(parseTime('1:05')).toBe(65);
    expect(formatTime(3725)).toBe('01:02:05');
  });

  it('reads SRT and joins cues into paragraphs at pauses', () => {
    const segs = parseSubtitles(SRT)!;
    expect(segs).toHaveLength(4);
    expect(segs[1].text).toBe('Today we read from the Shepherd of Hermas.');
    const paras = toParagraphs(segs);
    expect(paras.map((p) => p.text)).toEqual(['Grace and peace to you. Today we read from the Shepherd of Hermas.', 'Eusebius places it among the rejected writings. Athanasius says it may be read.']);
    expect(transcriptText(paras)).toBe('[00:00:01] Grace and peace to you. Today we read from the Shepherd of Hermas.\n\n[00:00:12] Eusebius places it among the rejected writings. Athanasius says it may be read.\n');
  });

  it('reads VTT and removes rolling duplicates from auto captions', () => {
    const segs = parseSubtitles(VTT)!;
    expect(segs.map((s) => s.text).join(' | ')).toBe('the canon was not fixed at once but grew over time');
    expect(isTranscriptFile('talk.vtt', VTT)).toBe(true);
    expect(isTranscriptFile('notes.txt', 'Hello there')).toBe(false);
  });

  it('reads timestamped lines', () => {
    const segs = parseSubtitles('[00:00:05] First point.\n[00:01:10] Second point,\ncontinued here.\n[00:02:00] Third.')!;
    expect(segs.map((s) => [s.start, s.text])).toEqual([
      [5, 'First point.'],
      [70, 'Second point, continued here.'],
      [120, 'Third.'],
    ]);
  });
});
