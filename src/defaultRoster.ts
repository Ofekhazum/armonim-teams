import type { Player } from './types';

// Roster published with the app: a device with no saved data starts with these
// players - names and identity only.
//
// **No real ratings live in this file, and that is a privacy boundary rather
// than an oversight.** Section 2.28 says the organiser's 1-5 rating never
// leaves their device, and `roster-worker.js` enforces exactly that on the
// wire: `rating`, `attack`, `avoid`, `chemistry` and `aliases` are stripped out
// of the public `GET /roster`. This file used to hand out the first two anyway
// - it ships inside the JS bundle every viewer downloads, and the repository is
// public, so every player's rating was readable by anybody who opened the app
// or the repo. The front door was locked and this was the open window.
//
// So the seeds below are deliberately neutral: `rating: 3` is the same
// `RATING_UNSEEN` that `mergePublicRoster` already falls back to for a player a
// device has never been told about, and `attack: 50` is `ATTACK_DEFAULT`, an
// even split. A viewer's device never needs the real numbers - everything it
// can show is counted from results, not from anybody's opinion. An organiser's
// device fills the real ones in a moment after unlocking admin, from
// `GET /roster/full`, which is the only route that has ever carried them.
//
// **Consequence worth knowing:** until admin is unlocked, every player shows
// the balanced role badge, because the badge is drawn from `attack`. That is
// the honest rendering of a field this device has not been told. If the role
// badges should be public, the fix is to take `attack` out of
// `PRIVATE_PLAYER_FIELDS` and publish it properly - not to smuggle it back in
// here.
//
// To update the names: Roster tab -> Export, then replace the array below with
// the downloaded file's contents **with the private fields stripped**.
export const DEFAULT_PLAYERS: Player[] = [
    {
      "id": "mrnag4a65q7lbc",
      "name": "אופק",
      "rating": 3,
      "attack": 50,
      "chemistry": [],
      "avoid": []
    },
    {
      "id": "mrnagchcdzzhr8",
      "name": "ירין",
      "rating": 3,
      "attack": 50,
      "chemistry": [],
      "avoid": []
    },
    {
      "id": "mrnbaphxaunwx5",
      "name": "יועד",
      "rating": 3,
      "attack": 50,
      "chemistry": [],
      "avoid": []
    },
    {
      "id": "mrnbl5r1l3ajni",
      "name": "חנש",
      "isGk": true,
      "rating": 3,
      "attack": 50,
      "chemistry": [],
      "avoid": []
    },
    {
      "id": "mrnblunakh31sv",
      "name": "חנגל",
      "rating": 3,
      "attack": 50,
      "chemistry": [],
      "avoid": []
    },
    {
      "id": "mrnbmufovnd0sv",
      "name": "הלחמי",
      "rating": 3,
      "attack": 50,
      "chemistry": [],
      "avoid": []
    },
    {
      "id": "mrnbn3l9028544",
      "name": "עובדיה",
      "rating": 3,
      "attack": 50,
      "chemistry": [],
      "avoid": []
    },
    {
      "id": "mrnbnlhn7akle6",
      "name": "ניב",
      "rating": 3,
      "attack": 50,
      "chemistry": [],
      "avoid": []
    },
    {
      "id": "mrnboh9tj4rwut",
      "name": "יוני",
      "rating": 3,
      "attack": 50,
      "chemistry": [],
      "avoid": []
    },
    {
      "id": "mrnbostx04orwl",
      "name": "דור",
      "rating": 3,
      "attack": 50,
      "chemistry": [],
      "avoid": []
    },
    {
      "id": "mrnbpty5a4wm8a",
      "name": "טאקו",
      "rating": 3,
      "attack": 50,
      "chemistry": [],
      "avoid": []
    },
    {
      "id": "mrnbqhf6r8my4o",
      "name": "עומרי",
      "rating": 3,
      "attack": 50,
      "chemistry": [],
      "avoid": []
    },
    {
      "id": "mrnbqtnuo5cgvy",
      "name": "ניר",
      "rating": 3,
      "attack": 50,
      "chemistry": [],
      "avoid": []
    },
    {
      "id": "mrnbrnjux6uflu",
      "name": "שגב",
      "rating": 3,
      "attack": 50,
      "chemistry": [],
      "avoid": []
    },
    {
      "id": "mrnbrzo03kcs1t",
      "name": "טום",
      "rating": 3,
      "attack": 50,
      "chemistry": [],
      "avoid": []
    },
    {
      "id": "mrnbtchahbjur2",
      "name": "עילאי פינק.",
      "rating": 3,
      "attack": 50,
      "chemistry": [],
      "avoid": []
    },
    {
      "id": "mrwkr7abw4lmne",
      "name": "פוגל",
      "rating": 3,
      "attack": 50,
      "chemistry": [],
      "avoid": []
    },
    {
      "id": "mrwkrry3opjg5o",
      "name": "שי משעל",
      "rating": 3,
      "attack": 50,
      "chemistry": [],
      "avoid": []
    },
    {
      "id": "mrwks197ufcwe6",
      "name": "אשד",
      "rating": 3,
      "attack": 50,
      "chemistry": [],
      "avoid": []
    },
    {
      "id": "mrwkseatqoqamy",
      "name": "מנצור",
      "rating": 3,
      "attack": 50,
      "chemistry": [],
      "avoid": []
    },
    {
      "id": "mrwktmmszocy9h",
      "name": "אריאל",
      "rating": 3,
      "attack": 50,
      "chemistry": [],
      "avoid": []
    }
  ];
