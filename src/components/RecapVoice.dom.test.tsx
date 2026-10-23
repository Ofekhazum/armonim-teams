import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { STRINGS } from '../strings';
import type { VoiceStatus } from '../recapVoice';
import * as api from '../recapVoice';
import RecapVoice from './RecapVoice';

// The recap read aloud (§2.69): the two taps. What the Worker will and will not
// voice is tested in worker/recap-voice.test.js; this is the wiring — that the
// button is absent until there is a voice to call, that the share sheet is only
// ever opened from its own tap, and that a job already running is picked up
// rather than started again.

vi.mock('../recapVoice', () => ({
  fetchVoiceStatus: vi.fn(),
  startVoice: vi.fn(),
  fetchVoiceFile: vi.fn(),
  shareVoiceFile: vi.fn(),
}));

const mocked = vi.mocked(api);

const s = (key: keyof typeof STRINGS): string => {
  const en = STRINGS[key].en;
  if (typeof en !== 'string') throw new Error(`${key} is a plural form, not a label`);
  return en;
};

const status = (over: Partial<VoiceStatus> = {}): VoiceStatus => ({
  configured: true,
  voiceable: true,
  status: 'none',
  ...over,
});

const FILE = new File([new Uint8Array([1, 2, 3])], 'armonim-recap-2026-10-20-AI-voice.mp3', {
  type: 'audio/mpeg',
});

const renderVoice = () =>
  render(<RecapVoice fixtureId="f1" date="2026-10-20" adminWord="word" recapAt={1} />);

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  mocked.fetchVoiceFile.mockResolvedValue(FILE);
  mocked.shareVoiceFile.mockResolvedValue('shared');
});

describe('RecapVoice', () => {
  it('shows nothing until the Worker has a voice to call', async () => {
    mocked.fetchVoiceStatus.mockResolvedValue(status({ configured: false }));
    const { container } = renderVoice();
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it('says why a hand-written report has no button', async () => {
    mocked.fetchVoiceStatus.mockResolvedValue(status({ voiceable: false }));
    renderVoice();
    expect(await screen.findByText(s('np.voice.handWritten'))).toBeInTheDocument();
    expect(screen.queryByText(s('np.voice.create'))).toBeNull();
  });

  it('is two taps: the first records, the second shares', async () => {
    mocked.fetchVoiceStatus.mockResolvedValue(status());
    mocked.startVoice.mockResolvedValue(status({ status: 'ready' }));
    renderVoice();
    fireEvent.click(await screen.findByText(s('np.voice.create')));
    const share = await screen.findByText(s('np.voice.share'));
    // nothing shared yet — that needs a tap of its own
    expect(mocked.shareVoiceFile).not.toHaveBeenCalled();
    fireEvent.click(share);
    await act(async () => {});
    expect(mocked.shareVoiceFile).toHaveBeenCalledWith(FILE, s('np.voice.shareText'));
  });

  it('waits on a running job, then fetches the file when it is ready', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocked.fetchVoiceStatus.mockResolvedValue(status());
    mocked.startVoice.mockResolvedValue(status({ status: 'working', startedAt: Date.now() }));
    renderVoice();
    fireEvent.click(await screen.findByText(s('np.voice.create')));
    expect(await screen.findByText(s('np.voice.workingHint'))).toBeInTheDocument();
    expect(mocked.fetchVoiceFile).not.toHaveBeenCalled();

    mocked.fetchVoiceStatus.mockResolvedValue(status({ status: 'ready' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(await screen.findByText(s('np.voice.share'))).toBeInTheDocument();
    expect(mocked.fetchVoiceFile).toHaveBeenCalledWith('f1', '2026-10-20', 'word');
  });

  it('picks up a job already running instead of starting another', async () => {
    mocked.fetchVoiceStatus.mockResolvedValue(status({ status: 'working', startedAt: Date.now() }));
    renderVoice();
    expect(await screen.findByText(s('np.voice.workingHint'))).toBeInTheDocument();
    expect(mocked.startVoice).not.toHaveBeenCalled();
  });

  it('says why the Worker refused', async () => {
    mocked.fetchVoiceStatus.mockResolvedValue(status());
    mocked.startVoice.mockResolvedValue({ error: 'too-many' });
    renderVoice();
    fireEvent.click(await screen.findByText(s('np.voice.create')));
    expect(await screen.findByText(s('np.voice.err.tooMany'))).toBeInTheDocument();
  });
});
