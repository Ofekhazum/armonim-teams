// Talking to the reporter's voice (§2.69).
//
// The app never sends words — only a fixture id. The Worker reads the recap
// stored for that night, refuses one that Gemini did not write, and runs the
// job on a Durable Object alarm, so these are three small calls rather than one
// long one: ask for it, ask how it is going, collect the file.

import { REMOTE_URL } from './remote';
import type { ShareImageResult } from './shareImage';

export interface VoiceStatus {
  configured: boolean; // the Worker has a voice server to call; no button otherwise
  voiceable: boolean; // the stored recap is one Gemini wrote
  status: 'none' | 'working' | 'ready' | 'failed';
  startedAt?: number;
  // while it is working: waiting for a GPU to free up, or on one (§2.69.2)
  phase?: 'queued' | 'running';
  // whether the recording was made with niqqud, and if not (or not fully) why (§2.71)
  pointed?: boolean;
  pointNote?: string;
  error?: string;
}

export type VoiceError =
  | 'not-configured'
  | 'wrong-word'
  | 'rate-limited' // wrong words from this address
  | 'too-many' // the right word, but the day's recordings are used up
  | 'no-recap'
  | 'not-generated' // written by hand: stored, readable, never spoken
  | 'error';

/** Where tonight's voiced recap stands. Public, and says nothing but that. */
export async function fetchVoiceStatus(fixtureId: string): Promise<VoiceStatus | null> {
  if (!REMOTE_URL) return null;
  try {
    const res = await fetch(`${REMOTE_URL}/recap-audio?id=${encodeURIComponent(fixtureId)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as VoiceStatus;
  } catch {
    return null;
  }
}

/** Start one (or, with `fresh`, another take). Answers at once; the work runs on. */
export async function startVoice(
  fixtureId: string,
  secret: string,
  fresh = false,
): Promise<VoiceStatus | { error: VoiceError }> {
  if (!REMOTE_URL) return { error: 'not-configured' };
  try {
    const res = await fetch(`${REMOTE_URL}/recap-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, fixtureId, ...(fresh ? { fresh: true } : {}) }),
    });
    if (res.status === 401) return { error: 'wrong-word' };
    if (res.status === 404) return { error: 'no-recap' };
    if (res.status === 409) return { error: 'not-generated' };
    if (res.status === 502) return { error: 'not-configured' };
    if (res.status === 429) {
      const said = await res.json().catch(() => ({}) as { error?: string });
      return { error: said.error === 'too many voices' ? 'too-many' : 'rate-limited' };
    }
    if (!res.ok) return { error: 'error' };
    return (await res.json()) as VoiceStatus;
  } catch {
    return { error: 'error' };
  }
}

/**
 * TEMPORARY (§2.71): the exact text the voice server was last sent for this
 * night — with its vowel points, if it got any — and, when pointing was rejected
 * or partly rejected, what the model answered. Null if there is none to show.
 */
export async function fetchSentText(
  fixtureId: string,
  secret: string,
): Promise<{ text: string; raw?: string } | null> {
  if (!REMOTE_URL) return null;
  try {
    const res = await fetch(`${REMOTE_URL}/recap-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, fixtureId, sent: true }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { text?: string; raw?: string };
    if (typeof body.text !== 'string') return null;
    return { text: body.text, ...(typeof body.raw === 'string' ? { raw: body.raw } : {}) };
  } catch {
    return null;
  }
}

/**
 * The finished MP3, as a File ready for the share sheet.
 *
 * The name says what it is. WhatsApp shows an audio file as a player and may
 * never show its name, so the share also carries a line of text and the MP3's
 * own tags say it again — but the filename is the one label that survives
 * being saved and sent on from somewhere else.
 */
export async function fetchVoiceFile(
  fixtureId: string,
  date: string,
  secret: string,
): Promise<File | null> {
  if (!REMOTE_URL) return null;
  try {
    const res = await fetch(`${REMOTE_URL}/recap-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, fixtureId, file: true }),
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    return new File([blob], `armonim-recap-${date}-AI-voice.mp3`, { type: 'audio/mpeg' });
  } catch {
    return null;
  }
}

/**
 * Hand the file to the OS share sheet, or download it where there is none.
 *
 * Must run inside the tap that asked for it: `navigator.share` needs a fresh
 * user gesture, and the gesture that started the recording expired minutes
 * ago. That is the whole reason this feature is two taps rather than one.
 */
export async function shareVoiceFile(file: File, text: string): Promise<ShareImageResult> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return 'shared';
    } catch (err) {
      // backing out of the share sheet is not a failure
      if (err instanceof DOMException && err.name === 'AbortError') return 'shared';
    }
  }
  try {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}
