// Which third of the club a rating puts somebody in.
//
// **One definition, in its own file, because two features depend on it and
// neither may drift from the other.** `marketValue.ts` turns it into a price
// multiplier (§2.31) and `grades.ts` into a small shade on a mark (§2.39), and
// both describe themselves as coarsening the rating to "a third of the club" —
// a sentence that quietly stops being true the moment one of them moves a
// boundary. Same reasoning as `derby.ts` importing `BOGEY_RATE` rather than
// re-declaring it.
//
// **Its own file rather than living in `marketValue.ts`**, which is where it
// started. `values.ts` dynamically imports that module on purpose, so the
// valuation formula and its ridge solver stay out of the main bundle for
// everyone who is not in the sandbox. `grades.ts` *is* in the main bundle, so
// importing two lines from `marketValue.ts` dragged the whole of it — solver
// included — back in for every device in the club. Vite says so out loud at
// build time ("dynamically imported by values.ts but also statically imported
// by grades.ts"), and the fix is for the shared constant to live somewhere
// neither feature owns.
//
// **This is the only shape the rating is allowed to travel in.** Three buckets
// rather than a number, because a continuous map from rating to anything
// published is invertible: knowing the other terms, you solve for the rating.
// Bucketed, the same arithmetic recovers only which third somebody is in.

export type RatingTier = 'bottom' | 'middle' | 'top';

export const ratingTier = (rating: number): RatingTier =>
  rating <= 2.5 ? 'bottom' : rating >= 4 ? 'top' : 'middle';
