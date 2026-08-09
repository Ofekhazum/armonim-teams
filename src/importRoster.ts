import type { Player } from './types';

// A section like "המתנה" (waiting list) marks reserves who aren't in this
// match's squad — stop reading once we hit it.
const STOP_HEADERS = new Set(['המתנה', 'רזרבה', 'ממתינים']);

// Strip Hebrew niqqud/cantillation too, in case a name was copied from
// somewhere that includes it — it's decoration, not part of the name.
const normalize = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/\s+/g, ' ');

function hasLetter(s: string): boolean {
  return /\p{L}/u.test(s);
}

// People tack notes onto a name — "דני (אורח)", "לירן (שוער)", "רון [2]" —
// that describe the entry rather than being part of the name. Peel off any
// number of trailing bracketed notes, plus straggling punctuation.
function stripTrailingNotes(raw: string): string {
  let s = raw;
  for (;;) {
    const next = s.replace(/\s*[([][^()[\]]*[)\]]\s*$/, '');
    if (next === s) break;
    s = next;
  }
  return s.replace(/[,;]+$/, '').trim();
}

function cleanName(raw: string): string | null {
  const name = stripTrailingNotes(raw.trim());
  return name && hasLetter(name) ? name : null;
}

// A number at the start of a line, and whatever separates it from the name
// — real punctuation ("1. Name", "1) Name", "1- Name"), or nothing but a
// space ("1 Name"), which is what people end up with when their phone's
// auto-numbering doesn't render the dot into the copied text.
const NUMBERED_LINE = /^(\d{1,3})([.):\-–—]?)\s*(.+)$/;

// A bullet list with no numbers at all — "• Name", "- Name", "* Name".
const BULLETED_LINE = /^[•*▪●○\-–—]\s*(.+)$/;

interface NumberedMatch {
  n: number;
  name: string;
  punctuated: boolean; // had a real separator, not just a bare space
}

function matchNumbered(line: string): NumberedMatch | null {
  const m = line.match(NUMBERED_LINE);
  if (!m) return null;
  const name = cleanName(m[3]);
  if (!name) return null;
  return { n: parseInt(m[1], 10), name, punctuated: m[2] !== '' };
}

// A clear majority, not "every single line" — a pasted list usually has a
// stray title or blank line mixed in that won't match anything.
const isMajority = (count: number, total: number): boolean => count >= Math.ceil(total * 0.6);

/**
 * Extracts player names, in order, from a pasted match-day list. Handles
 * numbered lists (with or without punctuation after the number, and
 * regardless of which punctuation), bulleted lists, and plain one-name-per-
 * line lists — picking whichever style the paste actually looks like it's
 * using, rather than assuming one fixed format.
 */
export function parseImportList(text: string): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    const trimmed = rawLine.trim();
    const header = trimmed.replace(/[^\p{L}]/gu, '');
    if (STOP_HEADERS.has(header)) break;
    if (/\d{1,2}:\d{2}/.test(trimmed)) continue; // e.g. a "19:00" time header
    if (trimmed) lines.push(trimmed);
  }
  if (lines.length === 0) return [];

  const numbered = lines.map(matchNumbered);
  const found = numbered.filter((n): n is NumberedMatch => !!n);

  // A real numbered list: most lines matched, and the numbers actually climb
  // (1, 2, 3, ... — gaps are fine) rather than a stray sentence's digit
  // breaking the run. This is what confirms unpunctuated "1 Name" lines are
  // really a list and not, say, "3 players still needed for Friday".
  const looksNumbered =
    isMajority(found.length, lines.length) &&
    found.every((n, i) => i === 0 || n.n > found[i - 1].n);
  if (looksNumbered) return found.map((n) => n.name);

  // Not confidently numbered — only trust the lines that used a real
  // separator, so an unrelated line that happens to start with a digit
  // doesn't get swept in as a name.
  const punctuatedOnly = found.filter((n) => n.punctuated).map((n) => n.name);
  if (isMajority(punctuatedOnly.length, lines.length)) return punctuatedOnly;

  const bulleted = lines
    .map((l) => l.match(BULLETED_LINE))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => cleanName(m[1]))
    .filter((n): n is string => !!n);
  if (isMajority(bulleted.length, lines.length)) return bulleted;

  // Nothing that looks like a number or a bullet — treat it as a plain
  // list, one name per line.
  return lines.map(cleanName).filter((n): n is string => !!n);
}

/** Finds a roster player whose name or alias matches, case/whitespace-insensitively. */
export function matchPlayer(name: string, players: Player[]): Player | undefined {
  const target = normalize(name);
  return players.find(
    (p) => normalize(p.name) === target || (p.aliases ?? []).some((a) => normalize(a) === target),
  );
}

export interface ImportResult {
  availableIds: string[]; // roster player ids to mark available
  guests: Player[]; // new guest players to add (unrecognized names)
  matchedNames: string[];
  guestNames: string[];
}

/** Matches parsed names against the roster; unrecognized names become guests. */
export function resolveImportedNames(
  names: string[],
  players: Player[],
  existingGuests: Player[],
  makeGuest: (name: string) => Player,
): ImportResult {
  const availableIds = new Set<string>();
  const guests: Player[] = [];
  const matchedNames: string[] = [];
  const guestNames: string[] = [];
  const seenGuestNames = new Set(existingGuests.map((g) => normalize(g.name)));

  for (const rawName of names) {
    const player = matchPlayer(rawName, players);
    if (player) {
      availableIds.add(player.id);
      matchedNames.push(player.name);
      continue;
    }
    const key = normalize(rawName);
    if (seenGuestNames.has(key)) continue; // already a guest — don't duplicate
    seenGuestNames.add(key);
    guests.push(makeGuest(rawName));
    guestNames.push(rawName);
  }

  return { availableIds: [...availableIds], guests, matchedNames, guestNames };
}
