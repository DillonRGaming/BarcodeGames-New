# Scribbled

A strange museum is selling off its collection, and every price tag has been scribbled out.
Players guess what each item is really worth. Whoever leaves richest wins.

Status: **parked idea**. Not built yet; Dying to Know comes first.

## Look

The realistic version in `prototype/exhibit.html` (open it in a browser):

- A white gallery: plain back wall, parquet floor, a wooden bench against the wall on each side.
- The room is slightly out of focus; only the exhibit is sharp.
- The item stands on a tall square wooden stool, cut off by the bottom of the frame.
- A kraft-paper price tag is tied round the item with twine, the price scribbled out in marker.
- Shot from across the room with a longer lens, so it reads like a photo, not a game render.

`prototype/flat-looks.html` keeps the 2D experiments for reference. We chose the realistic look.

## Players and length

- 3 to 8 players on phones, the TV is the museum. Works with strangers.
- About 15 minutes: 8 items in two halves, then a final round.
- Everyone starts on £0 and only earns by guessing well.

## One item (about 60 seconds)

1. **Reveal (5s):** lights up on a new exhibit with a scribbled tag. The host reads one line about it.
2. **Guess (20s):** everyone types a price on their phone.
3. **Price line (5s):** every guess appears as a paddle on a line along the bottom, cheap to expensive.
4. **Scratch-off (15s):** the scribble is scrubbed off one digit at a time, from the left.
   Each digit knocks out guesses that can no longer be right; their paddles drop off the line.
5. **Payout (10s):** closest wins the pot, exact guess wins a jackpot, near misses get a little.

## Twists

- **Double down:** after the price line appears, each player can secretly go double or nothing.
- **Don't go over (second half):** from item 5, guessing over the real price wins nothing.
- **Forgeries:** about one item in four is a fake worth almost nothing.

## Final round: Closing Time

Three items from the night come back with their prices hidden. Each player either picks the most
expensive one or bets on the total of all three, staking their winnings. Closest wins double.

## Phone

- Big number pad, a £ display, a Lock in button.
- Double down toggle when it's offered.
- Between items: just their money and place.

## Host

The museum curator: dry, snobbish, quietly judging every guess. ("Fourteen pounds. How... charming.")
All lines pre-generated with the voice pipeline from Dying to Know.

## Items

What makes or breaks the game. Real objects with real, surprising prices.

Each item needs:
- a 3D model (`models/<id>/model.glb`) or a high-quality cut-out photo
- one line of description for the host
- the real price, and a source for it
- whether it's a forgery

Aim for 60 to 100 items so games rarely repeat. Item list goes in `items.json`.

## Models

Put models in `models/`, one folder per item. Good free sources:
- Poly Haven (polyhaven.com): free, photo-scanned, CC0
- Sketchfab: filter by downloadable and a free licence; check each licence

The prototype's vase, stool, benches and room are drawn in code. Real scanned models are the
biggest single step towards it looking like an actual photo.

## Still to decide

1. Prices: real (£4,800, £2 million) or kept under a cap like £10,000?
2. All three twists, or start with only Double down?
3. 3D models for every item, or cut-out photos on the stool?

## Building it later

- New game folder `app/core/games/scribbled/`, reusing the room server and phone controller
  setup from Dying to Know.
- New phone controller in `web/games/scribbled/`.
