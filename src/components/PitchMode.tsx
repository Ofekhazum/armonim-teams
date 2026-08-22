import { useEffect } from 'react';
import { useScrollLock } from '../scrollLock';

// The clock as the only thing on screen (§2.8). A phone propped against a bag
// on the touchline is read from ten metres away by someone who isn't holding
// it — the ordinary fixture page is a card among other cards, sized for a hand.
//
// Dark ground rather than the app's cream: a bright field at full brightness in
// sunlight is glare, and the digits are what should be doing the shouting. It
// also happens to be what every scoreboard ever built looks like, which means
// nobody has to be told what they're looking at.
//
// Sized in viewport units so it fills a phone lying on its side as well as one
// standing up — `min(vw, vh)` is what stops a landscape screen rendering digits
// taller than it is.

interface Props {
  time: string; // already formatted mm:ss
  // one minute left, or level after added time — the two moments worth
  // turning the whole screen red for
  alert: boolean;
  headline: string | null;
  running: boolean;
  finished: boolean;
  idle: boolean;
  addedTime: boolean;
  // absent on a device that can only watch
  onStart?: () => void;
  onPause?: () => void;
  onAdded?: () => void;
  onNext?: () => void;
  onAddTime?: () => void;
  onExit: () => void;
}

// Sized so the three that are up during play — pause, +30s, next — sit on one
// row on the narrowest phone. Still a far bigger target than the card's, which
// is the point: this is pressed by someone who isn't looking closely.
const bigBtn =
  'rounded-2xl px-5 py-3.5 text-lg font-black tracking-tight shadow-lg transition-transform active:scale-95';

export default function PitchMode({
  time,
  alert,
  headline,
  running,
  finished,
  idle,
  addedTime,
  onStart,
  onPause,
  onAdded,
  onNext,
  onAddTime,
  onExit,
}: Props) {
  const controllable = onStart !== undefined;

  // Nothing on this screen scrolls, but the document under it still does —
  // which on iOS means the whole black panel rubber-bands away from the edge
  // and the fixture page shows through underneath. See scrollLock.ts.
  useScrollLock();

  // Escape is free on a laptop and costs nothing on a phone, where the ✕ is
  // the way out. Deliberately not "tap anywhere to close" — this thing lives
  // propped against a bag, and a stray elbow shouldn't end it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onExit();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  return (
    // Three bands rather than a centred stack: the clock takes whatever is
    // left after the headline and the controls, which keeps it centred in both
    // orientations instead of bunching against the buttons. The controls sit
    // low on purpose — a phone propped against a bag is reached at the bottom.
    <div className="fixed inset-0 z-50 flex touch-none flex-col overscroll-none bg-[#0f0d0a] px-4 text-center">
      <button
        onClick={onExit}
        title="Leave pitch mode"
        aria-label="Leave pitch mode"
        className="absolute right-3 top-3 rounded-full px-4 py-2 text-2xl font-bold text-amber-50/40 transition-colors hover:text-amber-50"
      >
        ✕
      </button>

      <div className="flex h-[12vh] shrink-0 items-end justify-center">
        {headline && (
          <div
            className={`text-[4.5vh] font-black uppercase leading-none tracking-widest ${
              alert ? 'text-red-400' : 'text-amber-300'
            }`}
          >
            {headline}
          </div>
        )}
      </div>

      <div className="flex flex-1 items-center justify-center">
        <div
          // the number is the whole point, so it gets whatever is left over
          // The vw term is what a standing phone runs out of and the vh term a
          // lying one. 34 rather than something rounder because "8:00" is four
          // glyphs wide: past about 36vw the digits run off the sides of a
          // portrait phone, which is not a thing you find out from the code.
          style={{ fontSize: 'min(34vw, 40vh)', lineHeight: 0.85 }}
          className={`font-mono font-black tabular-nums ${alert ? 'text-red-500' : 'text-amber-50'}`}
        >
          {time}
        </div>
      </div>

      {controllable ? (
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-3 pb-[6vh] pt-[2vh]">
          {!finished &&
            (running ? (
              <button onClick={onPause} className={`${bigBtn} bg-amber-50/15 text-amber-50`}>
                ⏸ Pause
              </button>
            ) : (
              <button onClick={onStart} className={`${bigBtn} bg-orange-600 text-amber-50`}>
                {idle ? (addedTime ? '▶️ Added time' : '▶️ Start') : '▶️ Resume'}
              </button>
            ))}

          {finished && !addedTime && (
            <button onClick={onAdded} className={`${bigBtn} bg-orange-600 text-amber-50`}>
              ⚽ Level — added time
            </button>
          )}

          {/* the stoppage button belongs here more than anywhere: this is the
              screen that is up while play is going on */}
          <button onClick={onAddTime} className={`${bigBtn} bg-amber-50/15 text-amber-50`}>
            +30s
          </button>

          <button onClick={onNext} className={`${bigBtn} bg-amber-50/15 text-amber-50`}>
            {finished || !idle ? '⏭ Next' : '↺ Reset'}
          </button>
        </div>
      ) : (
        // a watcher's screen: say why there are no buttons rather than leaving
        // a gap where the organiser's phone has them
        <p className="shrink-0 pb-[6vh] pt-[2vh] text-[2.2vh] font-semibold text-amber-50/35">
          Whoever is nearest the phone runs the clock
        </p>
      )}
    </div>
  );
}
