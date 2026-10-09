# activity-detail-replay-reward-presentation

## Goal

Refine the Activity Detail replay with a restrained, single-item reward callout
beside the XP-earned value. Preserve the existing replay snapshot, gameplay logic,
and map panel data and behavior.

## Scope

- Show `+0` XP at replay start and present a temporary item for each reached
  collectible or completed Flowline.
- Keep only one reward item visible at a time, with its icon/type, name, event
  label, and XP gained.
- Derive the visible reward and cumulative XP from replay time so seeking is
  deterministic; reset both on replay restart.
- Hide the existing map replay panel during playback and restore it at natural
  completion without changing its markup, data, row rendering, or state logic.
- Preserve the Activity Progress card as the XP area and finish at the persisted
  Activity XP exactly.

## Decisions

- Reward entries are sorted by historical timestamp, with a stable tie-breaker.
- A reward callout is eligible for 1,500 ms of playback time, translated onto
  the compressed activity timeline and shortened when the next event arrives.
  Only the current item is rendered; the previous item exits before its
  replacement appears.
- Collectible XP comes from its saved event value. Since snapshots store
  Flowline completion timestamps but not per-completion XP, their display value
  is derived evenly from persisted Activity XP minus saved collectible-event XP.
  This is presentation only and does not recalculate gameplay.
- Forward playback may animate XP toward the timestamp-derived cumulative target;
  seeking derives the number from the current time, and completion snaps to
  persisted Activity XP.
- Use Staza yellow for XP, a subtle icon/type cue, and restrained fade/slide
  motion. Flowline may use cyan as a small cue. Honor
  `prefers-reduced-motion`; do not use particles or confetti.

## Implementation plan

1. Derive a stable chronological reward sequence and deterministic active reward
   and cumulative-XP state from the replay timestamp.
2. Update the existing XP value and render a single temporary reward element
   beside it; do not append a growing reward list.
3. Expose distinct replay-start and natural-completion lifecycle signals so the
   map panel hides during active playback, remains hidden on pause, resets on
   restart, and returns at completion.
4. Add scoped callout styling and reduced-motion behavior without redesigning
   the existing panel.
5. Add focused tests for reward order, single-item visibility, event-time XP,
   seek/reset/completion behavior, and lifecycle signals.

## Expected files

- `public/components/activity-progress.js` — expose the persisted XP value and
  one hidden reward-callout host beside it.
- `public/components/activity-replay-map.js` — report replay-start and
  natural-completion lifecycle events while preserving timestamp updates.
- `public/components/activity-replay-map.test.js` — cover start, pause,
  completion, and restart signals.
- `public/components/replay-tab.js` — derive and render timestamp-based rewards
  and XP, and toggle the existing panel at the appropriate lifecycle points.
- `public/components/replay-tab.test.js` — cover chronology, one active reward,
  and deterministic XP/reward state.
- `public/components/activity-detail-page.test.js` — assert the XP/callout DOM
  hooks without altering the existing overlay.
- `public/styles/app-shell.css` — add restrained callout styling and reduced
  motion behavior.

## Acceptance criteria

- Replay start and restart hide the existing map panel, clear the temporary
  reward, and display `+0` XP.
- Collectible and Flowline rewards show one item at a time with their saved name,
  type, event label, and XP gain; the prior item exits before the next appears.
- Cumulative XP is derived from all reward events reached at the current replay
  time and ends exactly at persisted Activity XP.
- Seeking directly to a time yields the same reward and XP state as playback to
  that time.
- Natural replay completion clears the temporary reward, restores the existing
  panel with its unchanged final summary content, and shows persisted XP.
- Pausing does not act as completion. Existing replay and panel data/logic remain
  intact.
- Motion is premium and restrained, uses Staza yellow for XP, and respects
  reduced-motion preferences.

## Constraints

- Do not change activity processing, scoring rules, persisted data, progression,
  or gameplay.
- Do not redesign the existing replay panel or create a reward history/list.
- Do not add particles, confetti, animation dependencies, or unrelated changes.

## Validation

- Add focused tests in the replay-tab and activity-replay-map suites for
  timestamp derivation, reward ordering, one-at-a-time state, seek/reset/end
  behavior, and playback lifecycle semantics.
- Run the focused replay tests and `npm run build`.
