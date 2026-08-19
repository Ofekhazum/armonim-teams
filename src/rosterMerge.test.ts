import { describe, expect, it } from 'vitest';
import type { Player } from './types';
import type { PublicPlayer } from './remote';
import { mergePrivateFields, mergePublicRoster } from './rosterMerge';

const local = (over: Partial<Player> = {}): Player => ({
  id: 'p1',
  name: 'אופק',
  rating: 4,
  attack: 50,
  chemistry: [],
  avoid: [],
  aliases: [],
  ...over,
});

const shared = (over: Partial<PublicPlayer> = {}): PublicPlayer =>
  ({ id: 'p1', name: 'אופק', rating: 4, attack: 50, ...over }) as PublicPlayer;

describe('mergePublicRoster', () => {
  it('keeps the keep-apart list the public read is not allowed to carry', () => {
    // the whole point of stripping `avoid` server-side is undone if pulling
    // the roster then wipes it from the organiser's own device
    const prev = [local({ avoid: ['p2'], chemistry: ['p3'], aliases: ['חזום'] })];
    const merged = mergePublicRoster(prev, [shared({ rating: 5 })]);

    expect(merged[0].avoid).toEqual(['p2']);
    expect(merged[0].chemistry).toEqual(['p3']);
    expect(merged[0].aliases).toEqual(['חזום']);
    // …while still adopting what the shared copy is authoritative about
    expect(merged[0].rating).toBe(5);
  });

  it('takes names and ratings from the shared copy, not the stale local one', () => {
    const merged = mergePublicRoster(
      [local({ name: 'old name', rating: 2, attack: 0 })],
      [shared({ name: 'אופק', rating: 4, attack: 25 })],
    );
    expect(merged[0]).toMatchObject({ name: 'אופק', rating: 4, attack: 25 });
  });

  it('starts a player this device has never seen with empty private fields', () => {
    const merged = mergePublicRoster([], [shared({ id: 'new' })]);
    expect(merged[0]).toMatchObject({ id: 'new', chemistry: [], avoid: [], aliases: [] });
  });

  it('drops players the shared roster no longer has', () => {
    const merged = mergePublicRoster([local(), local({ id: 'gone' })], [shared()]);
    expect(merged.map((p) => p.id)).toEqual(['p1']);
  });

  it('still migrates a legacy playstyle roster', () => {
    const legacy = { id: 'p1', name: 'אופק', rating: 4, playstyle: 'attacking' } as never;
    expect(mergePublicRoster([], [legacy])[0].attack).toBe(100);
  });
});

describe('mergePrivateFields', () => {
  it('fills in what the admin-only read knows and leaves the rest alone', () => {
    // a freshly set-up admin device: it pulled the public roster, so it has
    // names and ratings, but no keep-apart lists until it unlocks
    const prev = [local({ name: 'אופק', rating: 4 })];
    const merged = mergePrivateFields(prev, [
      local({ name: 'stale name', rating: 1, avoid: ['p2'], aliases: ['חזום'] }),
    ]);

    expect(merged[0].avoid).toEqual(['p2']);
    expect(merged[0].aliases).toEqual(['חזום']);
    // the full read is authoritative about private fields only — the public
    // pull already settled the rest, and re-adopting it here would undo edits
    expect(merged[0]).toMatchObject({ name: 'אופק', rating: 4 });
  });

  it('leaves a locally-added player the shared roster has never heard of', () => {
    const guest = local({ id: 'guest', avoid: ['p1'] });
    const merged = mergePrivateFields([guest], []);
    expect(merged[0]).toBe(guest);
  });

  it('clears a private field that the shared copy no longer has', () => {
    const merged = mergePrivateFields([local({ avoid: ['p2'] })], [local({ avoid: [] })]);
    expect(merged[0].avoid).toEqual([]);
  });

  it('keeps roster order', () => {
    const merged = mergePrivateFields(
      [local({ id: 'a' }), local({ id: 'b' }), local({ id: 'c' })],
      [local({ id: 'c', avoid: ['a'] })],
    );
    expect(merged.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
});
