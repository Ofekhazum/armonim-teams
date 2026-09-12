/**
 * The rating panel and its column stay off — not because the estimator is
 * broken (it was, and the rebuild is done: §2.49–§2.51), but because this
 * club's own history is not yet enough evidence for it to speak reliably.
 *
 * Measured at this club's actual volume — five fixtures, two of them typed
 * tallies rather than a logged night — a genuine two-and-a-half-star error is
 * right about **31% of the time** when the panel does speak off a tally-only
 * night, and it stays silent off a logged one altogether (a short "winner
 * stays on" log spreads too thin to say anything yet). By twenty fixtures the
 * same numbers are 84% and 97% — the estimator gets *more* trustworthy with
 * more football, which is the property the whole rebuild was for. This club
 * is not there yet.
 *
 * So this is a volume switch, not a correctness one, and the honest thing is
 * to wait rather than show something that is more often wrong than right.
 * Flip it once the club has enough nights logged for `scripts/
 * calibration-report.ts`'s numbers to say the panel is worth reading —
 * there is no code change needed when that day comes.
 *
 * Its own module rather than a const in History.tsx, because the two things it
 * gates now live on two different pages (§2.55): the suggestions panel moved
 * to Admin tools, and the "vs rating" column stayed in the career table where
 * it is a column. One switch, two readers.
 */
export const RATING_PANEL_READY = false;
