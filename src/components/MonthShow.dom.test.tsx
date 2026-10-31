import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { STRINGS } from '../strings';
import * as api from '../monthShow';
import MonthShow from './MonthShow';

// The month's show on the workbench (§2.74). What the Worker writes and refuses
// is tested in worker/month-recap.test.js; this is the wiring — the persona
// reaches the draft, only a published show is recorded, and it is recorded
// under the month's id with the month's own share line.

vi.mock('../monthShow', async (real) => ({
  ...(await real<typeof import('../monthShow')>()),
  readMonthShow: vi.fn(),
  draftMonthShow: vi.fn(),
  saveMonthShow: vi.fn(),
  clearMonthShow: vi.fn(),
}));

// The voice has its own tests; here it is only asked what it was handed.
vi.mock('./RecapVoice', () => ({
  default: (props: { fixtureId: string; date: string; shareText?: string }) => (
    <div data-testid="voice" data-id={props.fixtureId} data-date={props.date}>
      {props.shareText}
    </div>
  ),
}));

const mocked = vi.mocked(api);

const s = (key: keyof typeof STRINGS): string => {
  const en = STRINGS[key].en;
  if (typeof en !== 'string') throw new Error(`${key} is a plural form, not a label`);
  return en;
};

const SHOW = 'אחיי ואחיותיי, איזה חודש.';

const renderShow = async (periods = ['2026-09', '2026-08']) => {
  render(<MonthShow periods={periods} adminWord="word" />);
  await act(async () => {});
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.readMonthShow.mockResolvedValue(null);
});

describe('MonthShow', () => {
  it('says why there is nothing to pick before any month is ready', async () => {
    await renderShow([]);
    expect(screen.getByText(s('tools.show.none'))).toBeTruthy();
  });

  it('writes the draft in the chosen persona, and records nothing until it is published', async () => {
    mocked.draftMonthShow.mockResolvedValue({ text: SHOW });
    await renderShow();
    fireEvent.change(screen.getByLabelText(s('np.report.persona.label')), { target: { value: 'bibi' } });
    await act(async () => fireEvent.click(screen.getByText(s('tools.show.write'))));

    expect(mocked.draftMonthShow).toHaveBeenCalledWith('2026-09', 'word', 'bibi');
    expect(screen.getByText(SHOW)).toBeTruthy();
    expect(screen.queryByTestId('voice')).toBeNull();
  });

  it('records a published show under the month’s id, with the month’s share line', async () => {
    mocked.draftMonthShow.mockResolvedValue({ text: SHOW });
    mocked.saveMonthShow.mockResolvedValue({ text: SHOW, at: 5 });
    await renderShow();
    await act(async () => fireEvent.click(screen.getByText(s('tools.show.write'))));
    await act(async () => fireEvent.click(screen.getByText(s('np.report.publish'))));

    expect(mocked.saveMonthShow).toHaveBeenCalledWith('2026-09', SHOW, 'word');
    const voice = screen.getByTestId('voice');
    expect(voice.dataset.id).toBe('month:2026-09');
    expect(voice.dataset.date).toBe('month-2026-09');
    expect(voice.textContent).toBe(s('tools.show.shareText'));
  });

  it('opens on the published show, and reads the month picked', async () => {
    mocked.readMonthShow.mockResolvedValue({ text: SHOW, at: 1 });
    await renderShow();
    expect(screen.getByText(SHOW)).toBeTruthy();
    expect(screen.getByTestId('voice')).toBeTruthy();

    await act(async () =>
      fireEvent.change(screen.getByLabelText(s('tools.show.month')), { target: { value: '2026-08' } }),
    );
    expect(mocked.readMonthShow).toHaveBeenLastCalledWith('2026-08', 'word');
  });

  it('says when the month on screen is not over, and only then', async () => {
    const d = new Date();
    const current = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    await renderShow([current, '2020-01']);
    expect(screen.getByText(s('tools.show.soFar'))).toBeTruthy();

    await act(async () =>
      fireEvent.change(screen.getByLabelText(s('tools.show.month')), { target: { value: '2020-01' } }),
    );
    expect(screen.queryByText(s('tools.show.soFar'))).toBeNull();
  });

  it('says a month is not ready in words, not as a failure', async () => {
    mocked.draftMonthShow.mockResolvedValue({ error: 'not-ready' });
    await renderShow();
    await act(async () => fireEvent.click(screen.getByText(s('tools.show.write'))));
    expect(screen.getByText(s('tools.show.err.notReady'))).toBeTruthy();
  });

  it('deletes the show for the month on screen', async () => {
    mocked.readMonthShow.mockResolvedValue({ text: SHOW, at: 1 });
    mocked.clearMonthShow.mockResolvedValue({ text: null });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await renderShow();
    await act(async () => fireEvent.click(screen.getByText(s('np.report.delete'))));
    expect(mocked.clearMonthShow).toHaveBeenCalledWith('2026-09', 'word');
    expect(screen.getByText(s('tools.show.nothing'))).toBeTruthy();
  });
});
