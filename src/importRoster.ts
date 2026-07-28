import type { Player } from './types';

// A section like "המתנה" (waiting list) marks reserves who aren't in this
// match's squad — stop reading once we hit it.
const STOP_HEADERS = new Set(['המתנה', 'רזרבה', 'ממתינים']);

const normalize = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

// Pulls a name out of a numbered line like "3. Name" / "12) Name" / "13.Name".
// Lines without a leading number (titles, emoji, "19:00" headers) are ignored.
function extractName(rawLine: string): string | null {
  const line = rawLine.trim();
  if (!line) return null;
  if (/\d{1,2}:\d{2}/.test(line)) return null; // e.g. "19:00" time header
  const m = line.match(/^(\d{1,3})[.)]\s*(.+)$/);
  if (!m) return null;
  const name = m[2].trim();
  return name || null;
}

/** Extracts player names, in order, from a pasted match-day list. */
export function parseImportList(text: string): string[] {
  const names: string[] = [];
  for (const rawLine of text.split('\n')) {
    const header = rawLine.trim().replace(/[^\p{L}]/gu, '');
    if (STOP_HEADERS.has(header)) break;
    const name = extractName(rawLine);
    if (name) names.push(name);
  }
  return names;
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
