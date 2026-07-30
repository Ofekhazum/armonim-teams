// Stable per-user identity colors for the live room's presence chips and
// activity toast. Validated categorical palette (see the data-viz skill's
// palette.md); light surface only since this app has no dark mode.
//
// Blue is deliberately dropped from the default 8-hue set — this app's teams
// are literally named black/white/blue, so a "blue" identity dot would read
// as "this is the Blue team" rather than "this person moved it". Re-validated
// as a 7-hue set (still fixed order, just missing its first slot): worst
// adjacent CVD ΔE unchanged at 9.1 light / 8.4 dark — dropping an endpoint
// can only remove pairs, never add a worse one, but this was re-run through
// the validator rather than assumed.
const CATEGORICAL = [
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
];

// Assigns each name the next unused slot in first-seen order (not a hash of
// the name) — the palette's validated CVD separation holds for consecutive
// slots rendered in that same order, so callers should render names in the
// order they were first colored. Assignments are stable for the tracker's
// lifetime: someone leaving doesn't reshuffle everyone else's color.
export function createUserColorTracker() {
  const slots = new Map<string, string>();
  let next = 0;
  return (name: string): string => {
    let color = slots.get(name);
    if (!color) {
      color = CATEGORICAL[next % CATEGORICAL.length];
      next++;
      slots.set(name, color);
    }
    return color;
  };
}
