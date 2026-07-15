import { parseIsoDurationMs, parseSrt, toMetadata } from './youtube-read.service';
import type { youtube_v3 } from 'googleapis';

describe('parseIsoDurationMs', () => {
  it('parses hours/minutes/seconds', () => {
    expect(parseIsoDurationMs('PT1H2M3S')).toBe(3_723_000);
  });

  it('parses minutes-only and seconds-only forms', () => {
    expect(parseIsoDurationMs('PT4M')).toBe(240_000);
    expect(parseIsoDurationMs('PT59S')).toBe(59_000);
  });

  it('parses fractional seconds', () => {
    expect(parseIsoDurationMs('PT1.5S')).toBe(1_500);
  });

  it('parses days (long premieres)', () => {
    expect(parseIsoDurationMs('P1DT1S')).toBe(86_401_000);
  });

  it('returns 0 for null, empty, and malformed input', () => {
    expect(parseIsoDurationMs(null)).toBe(0);
    expect(parseIsoDurationMs(undefined)).toBe(0);
    expect(parseIsoDurationMs('')).toBe(0);
    expect(parseIsoDurationMs('not-a-duration')).toBe(0);
  });
});

describe('parseSrt', () => {
  const SRT = [
    '1',
    '00:00:01,000 --> 00:00:03,500',
    'Hello world',
    '',
    '2',
    '00:00:04,000 --> 00:00:06,000',
    'Second line',
    'continues here',
  ].join('\n');

  it('parses cues with millisecond timing', () => {
    const cues = parseSrt(SRT);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ startMs: 1_000, endMs: 3_500, text: 'Hello world' });
  });

  it('joins multi-line cue text with spaces', () => {
    expect(parseSrt(SRT)[1]!.text).toBe('Second line continues here');
  });

  it('tolerates CRLF line endings and missing indices', () => {
    const crlf = '00:00:00,500 --> 00:00:01,000\r\nNo index line\r\n';
    expect(parseSrt(crlf)).toEqual([{ startMs: 500, endMs: 1_000, text: 'No index line' }]);
  });

  it('strips inline markup tags', () => {
    const tagged = '1\n00:00:01,000 --> 00:00:02,000\n<i>styled</i> text\n';
    expect(parseSrt(tagged)[0]!.text).toBe('styled text');
  });

  it('drops blocks without a timing line and returns [] for empty input', () => {
    expect(parseSrt('just some text\nwithout timing')).toEqual([]);
    expect(parseSrt('')).toEqual([]);
  });

  it('parses hour-long timestamps', () => {
    const late = '1\n01:02:03,004 --> 01:02:04,000\nLate cue\n';
    expect(parseSrt(late)[0]!.startMs).toBe(3_723_004);
  });
});

describe('toMetadata — original audio language', () => {
  const base: youtube_v3.Schema$Video = {
    id: 'vid1',
    snippet: { title: 'A video', channelId: 'UC123' },
    contentDetails: { duration: 'PT1M30S' },
  };

  it('prefers snippet.defaultAudioLanguage', () => {
    const meta = toMetadata({
      ...base,
      snippet: { ...base.snippet, defaultAudioLanguage: 'ta', defaultLanguage: 'en' },
    });
    expect(meta.defaultAudioLanguage).toBe('ta');
  });

  it('falls back to snippet.defaultLanguage when audio language is absent', () => {
    const meta = toMetadata({
      ...base,
      snippet: { ...base.snippet, defaultLanguage: 'hi' },
    });
    expect(meta.defaultAudioLanguage).toBe('hi');
  });

  it('is null when YouTube reports neither — the upload must omit the field, not guess', () => {
    const meta = toMetadata(base);
    expect(meta.defaultAudioLanguage).toBeNull();
    expect(meta.durationMs).toBe(90_000);
  });
});
