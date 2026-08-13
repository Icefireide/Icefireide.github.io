# Broadcast Tooling gallery — status and what the remaining six need

Written 2026-08-13. Not published; a working note for whoever picks this up.

## Where the gallery lives

**`tools.html`**, its own top-level page, reachable from the `Tools` tab in the
nav. It was moved out of `work.html` on 2026-08-13 — that page now carries only
the production-log stats and the year links, and does not link to the gallery.
References to `work.html` below describe the old location; the behaviour they
describe carried over unchanged.

## The bug that mattered more than the missing images

`work.html` built each card with `img.loading = 'lazy'`, inside a
`#tooling-section` that starts at `style="display:none"` and is revealed by the
first image's `onload`.

A lazy image inside a `display:none` subtree is never fetched. So `onload` never
fired to reveal the section, and `onerror` never fired to drop the broken cards.
**The section stays hidden because nothing loads, and nothing loads because the
section is hidden.** The gallery would never have appeared even with all six
screenshots present.

Fixed by setting `loading = 'eager'` — correct here, because these images decide
whether the section renders at all. Verified: section now visible, the one real
card survives, the six missing ones remove themselves as designed.

## Current state

| Entry | Image | Status |
|---|---|---|
| Riftbound — Broadcast Overlay | `tooling/riftbound-overlay.png` | **Live.** Links to an interactive demo at `tooling/riftbound/`. |
| MilkTeaBoards — Bo3 Map Ban | `tooling/mtb-map-ban.png` | Missing. Card self-removes. |
| MilkTeaBoards — Map Entrance | `tooling/mtb-map-entrance.png` | Missing. Card self-removes. |
| MilkTeaBoards — Operator Panel | `tooling/mtb-operator.png` | Missing. Card self-removes. |
| Division One — Team Lineups | `tooling/d1-lineup.png` | Missing. Card self-removes. |
| Division One — Series Scoreboard | `tooling/d1-scoreboard.png` | Missing. Card self-removes. |
| Division One — Control Panel | `tooling/d1-control.png` | Missing. Card self-removes. |

## What each remaining capture needs

### Division One (three entries)

`D:\Studio\Products\D1\` holds five tools, none of which map one-to-one onto the
three entries already written:

| Tool | HTML pages |
|---|---|
| LoL Stream Tool | 60 |
| Rocket League Tool | 9 |
| Valorant Stream Tool | 10 |
| LoL Observer Tool | 6 |
| Valorant Observer Tool | 2 |

So the first job is not capture, it is **deciding which tool and which page each
of the three entries actually refers to**. "Team Lineups", "Series Scoreboard"
and "Control Panel" could each come from the LoL or the Valorant tool, and the
captions imply league data that only one of them has.

Once decided, the Riftbound approach transfers directly:

1. Serve the tool's `public/` (or equivalent) over `http.server`.
2. Find the render entry point — for Riftbound that was `applySnapshot()`, driven
   by a WebSocket `{type:'state'}` message.
3. Mock the transport rather than editing the tool, so the copied render code
   stays byte-identical to production.
4. Screenshot the stage element with Playwright at native resolution.

**Risk to check first:** these tools are older than Riftbound and may render from
live API calls rather than a single snapshot function. If a page cannot be driven
without a real match feed, the honest options are a capture during an actual show
or leaving that entry out — not a hand-built mockup, which would contradict
`work.html`'s own claim that these are captured directly from the tools.

### MilkTeaBoards (three entries)

**Blocked.** `D:\Studio\Products\MTB\` is empty — the MTB app has not been split
out of its vault yet (see `D:\Studio\CLAUDE.md`, which flags this as pending).
There is nothing on disk to capture. This needs the split to happen first, or the
captures taken from wherever the running app currently lives.

## If any capture includes card, game or client art

The Riftbound demo ships a notice covering Riot Games' ownership of the card art
(`tooling/riftbound/index.html`, and a short form in `work.html`'s tooling
footer). Any further capture containing publisher art or a client's branding
needs the same treatment before it goes public.

## Interactive demos vs stills

Only Riftbound is interactive. The gallery supports both: a `link` field on a
`TOOLING` entry overrides the card's href, so a card can open a demo page instead
of its own screenshot. Entries without `link` keep the original behaviour.

An interactive demo is only honest where the real render code can be driven by a
mocked transport. Where that is not possible, a still is the right answer.
