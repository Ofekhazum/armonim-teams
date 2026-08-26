import { useEffect, useMemo, useState } from 'react';
import type { AchievementKind } from '../achievements';
import type { FixtureRecord, Player, TeamColor } from '../types';
import { roleBadge } from '../types';
import { TEAM_COLORS } from '../balancer';
import { playerAchievements, titleFor } from '../achievements';
import { computeDuoRecords } from '../duos';
import { hasResult } from '../calibration';
import type { Matchup, Place } from '../playerProfile';
import {
  MIN_PROFILE_NIGHTS,
  fixtureRungs,
  ladderBadges,
  mvpRungs,
  nightRungs,
  profileCounts,
  profileNights,
  shirtNights,
  shootoutRecord,
  matchupPicks,
  matchups,
  toGo,
  winRungs,
} from '../playerProfile';
import { MIN_ARC_NIGHTS, playerArcs } from '../playerArcs';
import NightParts from './NightParts';
import { playerTimeline } from '../playerTimeline';
import PlayerTimeline from './PlayerTimeline';
import { MEDAL, Name, STYLE_META, TEAM_META } from './ui';
import { useScrollLock } from '../scrollLock';
import { fetchAwards, monthsWon } from '../awards';
import type { PlayerValue } from '../values';
import { SHOW_MARKET_VALUE, fetchValues } from '../values';
import { fetchAllMarks } from '../gradesApi';
import { playerGradeSeries, type AllMarks } from '../gradeHistory';
import PriceTag from './PriceTag';
import GradeForm from './GradeForm';
import { periodLabel } from '../wrapped';

// One player's page (§2.19). Everything on it is counted from history — the
// same nights the standings table and the badges are built from — so nothing
// here needed new data, only gathering.
//
// Deliberately has no organiser half. Ratings, the attack spectrum and the
// keep-apart list are the organiser's working notes about a person, and this
// is the most screenshot-able page in the app; they stay on the roster row and
// in the edit form, behind admin, where they already were. ✏️ Edit reaches
// them for an admin, so nothing was taken away.

interface Props {
  player: Player;
  history: FixtureRecord[];
  players: Player[];
  isAdmin: boolean;
  onEdit: () => void;
  onClose: () => void;
}

// Badges are the one place on this page where colour carries meaning rather
// than decoration: seven identical cream pills is a list you have to read, and
// a wall of text is what a page of achievements must never be. Each kind keeps
// its own tone everywhere it appears, so 🥇 is the same gold on a profile as
// in the standings.
//
// Written out in full rather than composed, because Tailwind only ships the
// class names it can see in the source.
const BADGE_TONE: Record<AchievementKind, string> = {
  'most-wins': 'border-amber-500/40 bg-amber-400/20 text-amber-900',
  'most-fixtures': 'border-orange-500/40 bg-orange-400/20 text-orange-900',
  mvp: 'border-yellow-500/40 bg-yellow-300/25 text-yellow-900',
  shootouts: 'border-rose-500/35 bg-rose-400/15 text-rose-900',
  'iron-man': 'border-emerald-600/35 bg-emerald-400/15 text-emerald-900',
  'win-streak': 'border-sky-600/35 bg-sky-400/15 text-sky-900',
  'active-run': 'border-orange-500/45 bg-orange-400/20 text-orange-900',
  'ever-present': 'border-violet-500/35 bg-violet-400/15 text-violet-900',
  veteran: 'border-stone-500/35 bg-stone-400/15 text-stone-800',
};

// The ladder badges' tier ramp — a medallion whose colour is the tier, so a
// climb of arbitrarily many rungs stays legible without a label.
//
// Not bronze/silver/gold with everything past third place staying gold: the
// night ladder alone has rungs every 50 past the first two, so a long career
// clears far more than three of them, and a scheme that stopped distinguishing
// at "gold" would go quiet for exactly the players who have climbed the
// furthest — the opposite of what a tier is for. So this is seven steps, one
// hue each in the order competitive games settle on for exactly this problem
// (bronze → … → diamond), which makes it legible without a legend to people
// who have never opened this app before.
//
// Beyond the seventh rung the colour stops changing and starts pulsing. A
// ramp that kept inventing new hues forever would eventually repeat one by
// coincidence and imply a demotion; capping and adding motion instead says
// "as far as this scale goes" without lying about the direction.
const TIER_STYLE: { name: string; ring: string; fill: string }[] = [
  { name: 'Bronze', ring: 'ring-amber-800/50', fill: 'bg-gradient-to-br from-amber-500 to-amber-800 text-amber-50' },
  { name: 'Silver', ring: 'ring-slate-400/60', fill: 'bg-gradient-to-br from-slate-200 to-slate-400 text-slate-900' },
  { name: 'Gold', ring: 'ring-amber-500/60', fill: 'bg-gradient-to-br from-yellow-300 to-amber-500 text-amber-950' },
  { name: 'Emerald', ring: 'ring-emerald-500/50', fill: 'bg-gradient-to-br from-emerald-300 to-emerald-600 text-emerald-50' },
  { name: 'Sapphire', ring: 'ring-blue-500/50', fill: 'bg-gradient-to-br from-blue-300 to-blue-600 text-blue-50' },
  { name: 'Amethyst', ring: 'ring-violet-500/50', fill: 'bg-gradient-to-br from-violet-300 to-violet-600 text-violet-50' },
  { name: 'Diamond', ring: 'ring-cyan-300/70', fill: 'bg-gradient-to-br from-cyan-100 via-white to-cyan-200 text-cyan-900' },
];

// Where the team finished that night: gold, silver, bronze. Three teams means
// every night has all three, so a ribbon of medals is a complete picture of
// somebody's season in one line — and unlike a win/lose mark it distinguishes
// the second-place nights from the ones spent bottom.
//
// The palette itself lives in `ui.tsx`, shared with the club podiums (§2.36):
// a 2 here and a 2 there are the same claim in the same colours.

// White is the awkward one: a fill light enough to read as *white* is nearly
// the colour of the card behind it, and amber-200 — the obvious way out — just
// reads as yellow. So it gets a true white fill plus an inset edge, the same
// trick the white team card uses, which is what makes it look like a shirt
// rather than a missing bar.
const SHIRT_BAR: Record<TeamColor, string> = {
  black: 'bg-stone-800',
  white: 'bg-white ring-1 ring-inset ring-amber-900/30',
  blue: 'bg-blue-700',
};

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const Card = ({
  title,
  hint,
  children,
  className = '',
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <section
    className={`rounded-2xl border border-amber-900/10 bg-white/70 p-4 shadow-sm ring-1 ring-white/60 ${className}`}
  >
    <div className="mb-2.5 flex items-baseline gap-2">
      <h3 className="text-[13px] font-black uppercase tracking-wide text-amber-900/70">{title}</h3>
      {hint && <span className="text-[11px] text-amber-900/40">{hint}</span>}
    </div>
    {children}
  </section>
);

const Stat = ({ n, label, quiet }: { n: string; label: string; quiet?: boolean }) => (
  // A floor rather than min-w-0: five tiles that all shrink stay on one line
  // and squeeze the labels to nothing, where five that refuse to go below ~5rem
  // wrap to 3 + 2 on a phone and stay readable.
  <div className="min-w-[4.75rem] flex-1 rounded-xl border border-amber-900/10 bg-white/70 px-2 py-2.5 text-center shadow-sm">
    <div
      className={`font-mono text-2xl font-black leading-none tabular-nums ${
        quiet ? 'text-amber-900/30' : 'text-amber-950'
      }`}
    >
      {n}
    </div>
    <div className="mt-1.5 text-[10px] font-bold uppercase leading-tight tracking-wide text-amber-900/50">
      {label}
    </div>
  </div>
);

export default function PlayerPage({ player, history, players, isAdmin, onEdit, onClose }: Props) {
  // The page behind stays put while this is open — see scrollLock.ts for
  // what happens on a phone when it doesn't.
  useScrollLock();

  // same escape hatch as pitch mode — a full-screen panel that can only be
  // left by finding one small button is a panel people feel stuck in
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Awards are asked for, not worked out: they are a record of what was
  // announced, and this page is one of the two places that reads it back. Any
  // failure — offline, no worker, nothing registered yet — is an empty shelf
  // rather than an error, which is the right weight for a decoration.
  const [totm, setTotm] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    fetchAwards().then((awards) => {
      if (live) setTotm(monthsWon(awards, player.id));
    });
    return () => {
      live = false;
    };
  }, [player.id]);

  // The price, which this device cannot work out for itself: the formula needs
  // ratings and ratings do not leave the Worker (§2.28, §2.31). Undefined until
  // it arrives, and undefined forever if the club is too new or the phone is
  // offline — `PriceTag` renders nothing rather than an absence.
  //
  // Not asked for at all while the feature is hidden (see SHOW_MARKET_VALUE):
  // this page opens for every player on the roster, so a request nobody can
  // see the result of would be paid on every one of those opens.
  const [price, setPrice] = useState<PlayerValue | undefined>();
  useEffect(() => {
    if (!SHOW_MARKET_VALUE) return;
    let live = true;
    fetchValues(players, history).then((values) => {
      if (live) setPrice(values[player.id]);
    });
    return () => {
      live = false;
    };
  }, [player.id, players, history]);

  // Published marks for the whole club, joined against this device's own
  // archive for the dates (§2.39). One request rather than one per night —
  // see `readAllMarks` in the Worker. `{}` on any failure, so an offline
  // phone or a club with nothing published yet simply has no graph.
  const [marks, setMarks] = useState<AllMarks>({});
  useEffect(() => {
    let live = true;
    fetchAllMarks(history).then((all) => {
      if (live) setMarks(all);
    });
    return () => {
      live = false;
    };
  }, [history]);
  const gradePoints = useMemo(
    () => playerGradeSeries(history, marks, player.id),
    [history, marks, player.id],
  );

  // The same nights the ribbon is drawn from, read as a sequence of moments
  // rather than as a shape (§2.29). `totm` arrives from the network a beat
  // later, which simply adds shirts to a feed that was already correct.
  const timeline = useMemo(
    () => playerTimeline(history, player.id, totm),
    [history, player.id, totm],
  );

  const nights = useMemo(() => profileNights(history, player.id), [history, player.id]);
  const counts = useMemo(() => profileCounts(nights), [nights]);
  const shirts = useMemo(() => shirtNights(nights), [nights]);
  const shootouts = useMemo(() => shootoutRecord(history, player.id), [history, player.id]);
  // When their football happened, which only logged nights can answer (§2.23).
  // `arcs` also holds the early/late and off-the-bench tallies; those are
  // computed and deliberately not drawn — see the note in playerArcs.ts.
  const arcs = useMemo(() => playerArcs(history, player.id), [history, player.id]);
  const enoughArcs = arcs.loggedNights >= MIN_ARC_NIGHTS;
  const picks = useMemo(
    () => matchupPicks(matchups(history, player.id), counts.nights),
    [history, player.id],
  );
  // one call, two answers: the badge row, and the MVP tally underneath it —
  // playerAchievements already counts the picks while deciding who tops that
  // column, and counting them twice is how two numbers end up disagreeing
  const record = useMemo(() => playerAchievements(history).get(player.id), [history, player.id]);
  const badges = record?.achievements ?? [];
  const mvps = record?.mvps ?? 0;
  // the badge fewest people can hold, said as a name — and nothing at all
  // until the club has enough nights behind it for a title to mean something
  const recordedNights = useMemo(
    () => history.filter((fx) => hasResult(fx.wins)).length,
    [history],
  );
  const title = titleFor(badges, recordedNights);

  // Best and worst teammate, from the shrunk duo records (§2.10) — so four
  // nights at 100% doesn't get printed as a fact about a friendship.
  const duos = useMemo(() => {
    const ids = new Set(players.map((p) => p.id));
    ids.add(player.id);
    const nameOf = new Map(players.map((p) => [p.id, p.name]));
    return computeDuoRecords(history, ids, nameOf, player.id);
  }, [history, players, player.id]);

  // whichever half of the pair isn't the player whose page this is
  const other = (d: { aId: string; aName: string; bName: string }) =>
    d.aId === player.id ? d.bName : d.aName;

  const nextNight = toGo(nightRungs(counts.nights), counts.nights);
  const nextWin = toGo(winRungs(counts.wins), counts.wins);
  const nextFixture = toGo(fixtureRungs(counts.nightsWon), counts.nightsWon);
  const nextMvp = toGo(mvpRungs(mvps), mvps);
  const earned = ladderBadges(counts, mvps);

  // What the last tapped badge or medal said. A phone has no hover, so a
  // `title` alone leaves half the app's users with an undecodable chip — and a
  // modal for a one-line explanation is a heavier answer than the question
  // deserves. This is a caption that appears under whichever row was touched,
  // and goes away when something else is.
  const [detail, setDetail] = useState<{ where: 'badges' | 'nights'; text: string } | null>(null);
  const say = (where: 'badges' | 'nights', text: string) => () =>
    setDetail((d) => (d?.text === text ? null : { where, text }));
  const caption = (where: 'badges' | 'nights') =>
    detail?.where === where ? (
      <p className="mt-2 text-xs font-semibold text-amber-900/70">{detail.text}</p>
    ) : null;
  const enoughLogged = shootouts.loggedNights >= MIN_PROFILE_NIGHTS;
  const role = STYLE_META[roleBadge(player)];

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto overscroll-contain bg-[#fdf6e3]">
      <div className="mx-auto max-w-3xl space-y-3 px-3 pb-16 pt-4 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-amber-900/25 px-3 py-1.5 text-sm font-bold text-amber-900 transition-colors hover:border-orange-500"
          >
            ← Back
          </button>
          <div className="flex-1" />
          {isAdmin && (
            <button
              onClick={onEdit}
              className="rounded-lg border border-amber-900/25 px-3 py-1.5 text-sm font-bold text-amber-900 transition-colors hover:border-orange-500"
            >
              ✏️ Edit
            </button>
          )}
        </div>

        {/* The header is the one piece of this page that is allowed to be
            decorative. A name in the same 14px as everything under it makes a
            profile read as a report about a row in a table; this makes it read
            as somebody's page. The shirt number is set huge and nearly
            transparent behind the name — the way it sits on an actual shirt. */}
        <header className="relative overflow-hidden rounded-2xl border border-amber-900/10 bg-gradient-to-br from-orange-400/25 via-amber-200/40 to-[#fffdf4] px-5 py-5 shadow-sm">
          {player.number !== undefined && (
            <span
              aria-hidden
              className="pointer-events-none absolute -top-3 right-3 select-none font-mono text-[6.5rem] font-black leading-none text-amber-900/[0.07]"
            >
              {player.number}
            </span>
          )}
          <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-3xl font-black tracking-tight text-amber-950 sm:text-4xl">
              <Name>{player.name}</Name>
            </h2>
            <span
              title={role.label}
              className="rounded-full border border-amber-900/15 bg-white/70 px-2.5 py-1 text-xs font-bold text-amber-900"
            >
              {role.icon} {role.label}
            </span>
            {player.isGuest && (
              <span className="rounded-full border border-amber-900/15 bg-white/70 px-2.5 py-1 text-xs font-bold text-amber-900/70">
                ★ Guest
              </span>
            )}
          </div>
          {title && (
            <p className="relative mt-1.5 text-sm font-black uppercase tracking-[0.2em] text-orange-700/80">
              {title}
            </p>
          )}
          {(player.aliases ?? []).length > 0 && (
            <p className="relative mt-1 text-xs font-semibold text-amber-900/45">
              aka {player.aliases!.join(', ')}
            </p>
          )}
          {/* Inside the header rather than in a card of its own, because a
              price is an attribute of the player the way the name and the
              title are — the cards below are all *counts about* them. It is
              also where Transfermarkt puts it, which is the reference anyone
              reading it already has.

              Hidden for now — see SHOW_MARKET_VALUE in values.ts. The tag and
              its formula are untouched behind it. */}
          {SHOW_MARKET_VALUE && <PriceTag price={price} />}
        </header>

        {/* The one honour on this page that is a *selection* rather than a
            count. Everything else here is arithmetic about them; this is the
            thing they were picked for, and it is a record of an announcement
            rather than something recomputed on the spot (§2.25) — so it can
            say when, which a derived membership never could.

            Absent at zero, deliberately. Most players will never make a
            five-man team, and a permanent empty trophy cabinet is a page
            telling them so every time they open it: absent reads as neutral
            where "×0" reads as a verdict, which is the §2.9 line. */}
        {totm.length > 0 && (
          <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-300/25 to-[#fffdf4] px-4 py-3 shadow-sm">
            <div className="mb-1.5 flex items-baseline gap-2">
              <h3 className="text-[13px] font-black uppercase tracking-wide text-amber-900/70">
                👕 Team of the Month
              </h3>
              <span className="text-[11px] font-bold text-amber-900/40">×{totm.length}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {totm.map((period) => (
                <span
                  key={period}
                  // `totmEligible` wants half the month's nights, so somebody
                  // can play brilliantly in a month they mostly missed and not
                  // be eligible. Correct for "of the month", and it looks like
                  // a bug to the player it happens to without this sentence.
                  title="Picked in the five for this month. Needs at least half the month's nights to be eligible."
                  className="rounded-full border border-amber-600/30 bg-white/70 px-2.5 py-1 text-xs font-bold text-amber-900 shadow-sm"
                >
                  {periodLabel(period)}
                </span>
              ))}
            </div>
          </div>
        )}

        {(badges.length > 0 || earned.length > 0) && (
          <div className="space-y-2.5">
            {/* Ladder badges: the things this player has finished, as
                medallions whose colour is the tier — see TIER_STYLE. Their own
                row, because a circle-and-label stack and a one-line pill do not
                share a baseline gracefully in the same flex row. */}
            {earned.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-2">
                {earned.map((b) => {
                  const style = TIER_STYLE[Math.min(b.tier, TIER_STYLE.length) - 1];
                  const maxed = b.tier >= TIER_STYLE.length;
                  const said = `${style.name} — ${b.detail}`;
                  return (
                    <button
                      key={b.key}
                      title={said}
                      onClick={say('badges', said)}
                      className="flex w-14 flex-col items-center gap-1 transition-transform hover:scale-105"
                    >
                      <span
                        className={`grid h-11 w-11 place-items-center rounded-full text-lg shadow-sm ring-2 ${style.ring} ${style.fill} ${
                          maxed ? 'animate-pulse' : ''
                        }`}
                      >
                        {b.icon}
                      </span>
                      <span className="w-full truncate text-center text-[10px] font-bold leading-tight text-amber-900/70">
                        {b.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {/* Achievement badges: things they currently top, unaffected by
                this — a superlative is held or not, and has no ladder to be a
                tier of. */}
            {badges.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {badges.map((b) => (
                  <button
                    key={b.kind}
                    title={b.label}
                    onClick={say('badges', b.label)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-bold shadow-sm transition-transform hover:scale-105 ${BADGE_TONE[b.kind]}`}
                  >
                    {b.icon} {b.label}
                  </button>
                ))}
              </div>
            )}
            {caption('badges')}
          </div>
        )}

        {counts.onSheet === 0 ? (
          <Card title="No football yet">
            <p className="text-sm text-amber-900/60">
              Nothing to count — this player hasn't been on a recorded team sheet.
            </p>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Stat n={String(counts.nights)} label="nights" />
              <Stat n={String(counts.nightsWon)} label="nights won" />
              <Stat n={fmt(counts.wins)} label="match wins" />
              <Stat
                n={counts.perNight === null ? '–' : counts.perNight.toFixed(1)}
                label="per night"
                quiet={counts.perNight === null}
              />
              {/* No threshold on this one, unlike the rate beside it: a pick is
                  a thing that either happened or didn't, and "0" is the true
                  answer rather than a small sample of one. Shown for everybody
                  so a zero is legible as none rather than as untracked. */}
              <Stat n={String(mvps)} label={mvps === 1 ? 'MVP night' : 'MVP nights'} quiet={mvps === 0} />
            </div>

            <Card
              title="Every night"
              hint={`oldest first · ${counts.onSheet} played`}
            >
              {/* One medal per night. A night with no result recorded is not a
                  third place — nobody finished anywhere — so it gets no medal
                  at all rather than the bottom one. */}
              <div className="flex flex-wrap gap-1.5">
                {nights.map((n) => {
                  // The date and the shirt, and nothing else: the medal in
                  // the square already says where they finished, and repeating
                  // it in words was the caption explaining the thing you were
                  // looking at rather than the thing you couldn't see.
                  const said = `${n.date} — ${TEAM_META[n.shirt].emoji}`;
                  return (
                    <button
                      key={n.fixtureId}
                      title={said}
                      onClick={say('nights', said)}
                      className={`grid h-8 w-8 place-items-center rounded-lg font-mono text-xs font-black shadow-sm transition-transform hover:scale-110 ${
                        n.place === null
                          ? 'border border-dashed border-amber-900/25 text-amber-900/30'
                          : MEDAL[n.place]
                      }`}
                    >
                      {n.place ?? '·'}
                    </button>
                  );
                })}
              </div>
              {/* No gold/silver/bronze key underneath. The squares are 1, 2 and
                  3 in medal colours — a legend spelling that out is a caption on
                  a thing nobody was confused by, and it was the widest line in
                  the card. Only the runs get a line, and only when there is one. */}
              {(counts.bestRun >= 2 || counts.currentRun >= 2) && (
                <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-amber-900/55">
                  {counts.bestRun >= 2 && (
                    <span>
                      best run <b className="text-amber-900">{counts.bestRun}</b>
                    </span>
                  )}
                  {counts.currentRun >= 2 && (
                    <span>
                      on <b className="text-amber-900">{counts.currentRun}</b> right now 🔥
                    </span>
                  )}
                </p>
              )}
              {caption('nights')}
            </Card>

            {/* Between the ribbon and the timeline, because it is the third
                way of asking about the same nights and sits naturally in the
                middle of them: the ribbon is where they finished, this is how
                well they played, the timeline is what happened. Absent
                entirely for a player nobody has ever published a mark for —
                see the note on `gradePoints`. */}
            {gradePoints.length > 0 && (
              <Card title="Form" hint="published marks">
                <GradeForm points={gradePoints} />
              </Card>
            )}

            {/* Directly under the ribbon, because they are the same nights
                asked two different questions. The ribbon answers "how has it
                gone"; this answers "what happened, and when". */}
            <Card title="The story so far" hint="newest first">
              <PlayerTimeline events={timeline} />
            </Card>

            <div className="grid gap-3 sm:grid-cols-2">
              <Card title="Milestones">
                <div className="space-y-3">
                  <Progress now={counts.nights} next={nextNight} unit="nights" />
                  <Progress now={Math.floor(counts.wins)} next={nextWin} unit="wins" />
                  <Progress now={counts.nightsWon} next={nextFixture} unit="nights won" />
                  <Progress now={mvps} next={nextMvp} unit="MVPs" />
                </div>
              </Card>

              <Card title="Shirts worn">
                <div className="space-y-2">
                  {TEAM_COLORS.map((c: TeamColor) => (
                    <div key={c} className="flex items-center gap-2 text-sm">
                      <span className="w-20 shrink-0 font-bold text-amber-950">
                        {TEAM_META[c].emoji} {TEAM_META[c].label}
                      </span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-amber-900/[0.07]">
                        <div
                          className={`h-full rounded-full transition-[width] ${SHIRT_BAR[c]}`}
                          style={{
                            width: `${counts.onSheet ? (shirts[c] / counts.onSheet) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <span className="w-5 text-right font-mono text-xs font-black tabular-nums text-amber-900/70">
                        {shirts[c]}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Card title="Mates and rivals">
                {!picks.playedMost && !picks.facedMost ? (
                  <p className="text-sm text-amber-900/55">
                    {counts.nights < MIN_PROFILE_NIGHTS
                      ? `Needs ${MIN_PROFILE_NIGHTS} nights before any of this is about them — ${counts.nights} so far.`
                      : 'Nobody they have shared enough football with yet.'}
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {/* Plain counts, in two halves, and every tail is kept to a
                        few words: the label already says what the number is, so
                        anything more wraps onto a second line and reads like
                        small print. The counts are still team results (§2.18) —
                        the copy addresses the player because this is their
                        page, not because a person won a match on their own. */}
                    <div className="space-y-1">
                      <Line
                        icon="🔗"
                        label="Most nights with"
                        m={picks.playedMost}
                        tail={(m) =>
                          `${m.together} of ${counts.nights}${
                            counts.nights ? ` · ${Math.round((m.together / counts.nights) * 100)}%` : ''
                          }`
                        }
                      />
                      <Line
                        icon="🏆"
                        label="Won most with"
                        m={picks.wonMost}
                        tail={(m) => `${m.togetherWon} nights won`}
                      />
                      <Line
                        icon="👻"
                        label="Never once alongside"
                        m={picks.neverTogether}
                        tail={(m) => `${m.against} nights opposite`}
                      />
                    </div>
                    <div className="space-y-1 border-t border-amber-900/10 pt-2">
                      <Line
                        icon="⚔️"
                        label="Faced most"
                        m={picks.facedMost}
                        tail={(m) => `${m.faced} matches`}
                      />
                      <Line
                        icon="😤"
                        label="Bogey man"
                        m={picks.bogey}
                        // The denominator is the point: the pick is made on
                        // the *share*, so "23 times" alone would leave a
                        // reader unable to see why this name and not a longer
                        // record with more losses in it.
                        tail={(m) => `has beaten you ${m.beatenBy} of ${m.faced}`}
                      />
                      <Line
                        icon="😎"
                        label="Favourite victim"
                        m={picks.victim}
                        tail={(m) => `beaten by you ${m.beat} of ${m.faced}`}
                      />
                      <Line
                        icon="🤜"
                        label="Worthy opponent"
                        m={picks.worthy}
                        tail={(m) => `${m.beat}–${m.beatenBy} — nothing in it`}
                      />
                      {/* The whole head-to-head half is counted in matches, so
                          it can only speak about nights somebody wrote down
                          match by match. Saying so beats an empty space. */}
                      {!picks.facedMost && !picks.bogey && !picks.victim && (
                        <p className="text-xs text-amber-900/50">
                          Head-to-head needs nights logged match by match — a night alone can't say
                          who beat whom.
                        </p>
                      )}
                    </div>
                    {/* The one claim on this card, as against the six counts
                        above it: a pair that has genuinely pulled away from
                        chance after shrinkage (§2.10). Silent most seasons,
                        which is why it costs nothing to leave in. */}
                    {(duos.best || duos.worst) && (
                      <div className="space-y-1 border-t border-amber-900/10 pt-2">
                        {duos.best && (
                          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                            <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-emerald-800/60">
                              🤝 Wins more with
                            </span>
                            <Name className="font-black text-amber-950">{other(duos.best)}</Name>
                            <span className="text-xs text-amber-900/55">
                              {duos.best.won} of {duos.best.together} nights
                            </span>
                          </div>
                        )}
                        {duos.worst && (
                          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                            <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-amber-900/45">
                              🙃 Wins less with
                            </span>
                            <Name className="font-black text-amber-950">{other(duos.worst)}</Name>
                            <span className="text-xs text-amber-900/55">
                              {duos.worst.won} of {duos.worst.together} nights
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </Card>

              <Card
                title="Shootouts"
                hint={enoughLogged ? `${shootouts.loggedNights} logged nights` : undefined}
              >
                {enoughLogged ? (
                  <div className="flex gap-2">
                    <div className="flex-1 rounded-xl bg-rose-400/10 px-3 py-2 text-center">
                      <div className="font-mono text-2xl font-black leading-none text-rose-900">
                        {shootouts.taken}
                      </div>
                      <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-rose-900/60">
                        on penalties
                      </div>
                    </div>
                    <div className="flex-1 rounded-xl bg-amber-900/[0.05] px-3 py-2 text-center">
                      <div className="font-mono text-2xl font-black leading-none text-amber-950">
                        {shootouts.wonInPlay}
                      </div>
                      <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-amber-900/50">
                        won in play
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-amber-900/55">
                    Only nights logged match by match can answer this — {shootouts.loggedNights} so
                    far, {MIN_PROFILE_NIGHTS} needed.
                  </p>
                )}
              </Card>
            </div>

            {/* When their football happens, as against how much of it there is
                (§2.23). Held to counts on purpose: the record is allowed to say
                what it says, and the app never turns that into a word about
                somebody's character. */}
            <Card
              title="Across the night"
              hint={enoughArcs ? `${arcs.matches} matches logged` : undefined}
            >
              {!enoughArcs ? (
                <p className="text-sm text-amber-900/55">
                  This one needs nights logged match by match — {arcs.loggedNights} so far,{' '}
                  {MIN_ARC_NIGHTS} needed. A tallied night says how much they won, never when.
                </p>
              ) : (
                <NightParts arcs={arcs} />
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

// A rung as a bar rather than a sentence. "No nights milestone yet" said
// nothing twice; a filling bar says the same thing while also showing how far
// along it is — and it turns the fixture page's announcement into an arrival
// somebody could see coming.
// One labelled fact about one player, or nothing at all. Rendering an empty
// row with a dash would fill the card with places where the answer is "not
// yet", which is the shape the old Teammates card failed in.
function Line({
  icon,
  label,
  m,
  tail,
}: {
  icon: string;
  label: string;
  m: Matchup | null;
  tail: (m: Matchup) => string;
}) {
  if (!m) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-amber-900/45">
        {icon} {label}
      </span>
      <Name className="font-black text-amber-950">{m.name}</Name>
      <span className="text-xs text-amber-900/55">{tail(m)}</span>
    </div>
  );
}

function Progress({
  now,
  next,
  unit,
}: {
  now: number;
  next: { target: number; away: number } | null;
  unit: string;
}) {
  if (!next) {
    return (
      <div className="text-sm font-bold text-amber-950">
        {now} {unit} — every milestone passed 🎖️
      </div>
    );
  }
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-bold text-amber-950">
          <span className="font-mono tabular-nums">{now}</span>
          <span className="text-amber-900/40"> / {next.target}</span> {unit}
        </span>
        <span className="text-[11px] font-semibold text-amber-900/50">{next.away} to go</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-amber-900/[0.07]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500"
          style={{ width: `${Math.min(100, (now / next.target) * 100)}%` }}
        />
      </div>
    </div>
  );
}
