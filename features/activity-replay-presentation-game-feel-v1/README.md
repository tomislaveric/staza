# Activity Replay Presentation / Game Feel V1

## Goal

Make the FIT activity replay feel like a lightweight, rewarding ride recap while
remaining a dependency-free presentation of the existing activity result. It must
immediately answer:

1. Where did I ride?
2. What did I collect?
3. How much did I earn?

## Scope

The browser replay will improve visual hierarchy for the route, rider, relevant
collectibles, current collection feedback, score/count, event feed, and secondary
ride statistics. It will add explicit available, collecting, and collected marker
states; subtle rarity and collectible-type presentation; a compact next relevant
collectible indicator; a ride-completion state; a small next-ride near-miss
summary; and responsive replay-region layout.

The replay remains a timestamp-faithful Canvas recap with Play, Pause, and Restart
controls only. It uses existing browser APIs, Canvas, CSS transitions, and
`requestAnimationFrame`.

## Current architecture

`public/app.js` retrieves an Activity and ActivityResult and mounts
`public/replay.js`. The replay:

- derives route bounds and projects route/world points with aspect-ratio-preserving
  padding;
- draws a subdued full route and highlighted timestamp-completed route;
- uses FIT timestamps and interpolated rider positions over a 12–30 second replay;
- renders server-provided relevant collectibles and preserves a fallback marker for
  collected event sources absent from that source list;
- derives score and event-feed content from canonical activity events.

Normalized world `Collectible` data provides `id`, `name`, `type`, optional
`rarity`, and value. Event-time metadata provides name, type, and optional rarity,
while the GameEvent supplies value, source relationship, position, and activity
timestamp. Browser replay and video HUD share this data but retain independent
renderers.

## Decisions

### Visual hierarchy

The full route is visually subdued, the completed route is high contrast, and the
rider is rendered above every map feature with a clear outlined marker and
restrained emphasis. Persistent score and count live in accessible DOM content so
the Canvas remains route-first.

### Collectible states

| State | Behavior |
| --- | --- |
| Available | Normal type- and rarity-decorated marker. |
| Collecting | The event inside a short feedback window receives scale/pulse emphasis. |
| Collected | The marker remains at its route location with reduced opacity and a completion/check decoration. |

Collected objects do not disappear, allowing users to understand their collection
location.

### Rarity and type

`common`, `rare`, and `epic` have centralized presentation tokens/classes and
human-readable labels. Color is supplemental rather than the only rarity signal.
Missing optional rarity renders without a badge.

Coins use compact token-like markers. Landmarks use a subtly more
location-oriented marker and may show a restrained label where space permits.
These are visual differences only: both types retain identical world-query,
detection, score, and timing behavior.

### Feedback, score, feed, and next item

At an event timestamp, a non-pausing collection card appears for approximately 1.5
seconds with collectible name, awarded XP, and optional rarity. Score and collected
count update at the event time and may receive a small CSS emphasis; no counting
animation is required. Final replay score equals `ActivityResult.totalPoints`.

The compact newest-first feed shows a collected state, human-readable name,
`+XP`, and optional rarity. It uses event metadata and falls back to `sourceId`
only if a display name is unexpectedly unavailable.

While collectible events remain, the replay shows a compact `Next` indicator for
the first not-yet-collected item from the existing server-provided relevant subset,
with its display name and approximate straight-line distance from the interpolated
rider. It adds no query, route, turn instruction, or navigation behavior.

### Completion and empty rides

At replay end, show a compact `Ride complete` state with collected count and total
XP. Zero-collectible rides are valid and show `0 collectibles` and `0 XP`, while
still replaying route, rider, and relevant uncollected collectibles when present.
Restart resets active feedback and replays this state naturally.

### Near-miss / next-ride targets

Near misses are compact, derived post-ride presentation data. An uncollected
collectible from the existing relevant subset is a near miss when its minimum
distance to the activity route is at most `NEAR_MISS_THRESHOLD_METERS` (200 m).
This threshold is independent of world-query padding and does not change precise
collection-radius detection, events, scoring, or XP.

`ActivityResult.nearMisses` contains at most `MAX_NEAR_MISSES` (5) entries,
sorted by minimum route distance. Each entry includes the collectible ID,
human-readable name, value, optional rarity, and minimum distance. No `GameEvent`
is created. When the list is non-empty, the post-ride summary shows the motivating
heading `Almost got these` and each name with its rounded distance; zero near
misses produce no empty section. Near-miss collectibles remain ordinary available
replay markers.

### Responsive layout

Only the activity-result region changes: map, score/feedback, controls, and feed
remain usable at narrow/mobile-like widths. The Canvas does not overflow; text
wraps compactly and controls retain readable touch-sized labels. The application
shell, upload flow, and video-selection layout are not redesigned.

## Implementation plan

1. Enhance `public/replay.js` with pure, exported helpers for marker state,
   rarity/type presentation, event-time state, next-item data, score, feed
   display data, and completion state. Retain timestamp interpolation, projection,
   relevant source use, and missing-source marker fallback.
2. Update Canvas drawing layers for the proposed route, rider, marker, and
   collecting-state hierarchy.
3. Add replay score/count, current feedback, next-item, completion, compact feed,
   and conditional near-miss DOM surfaces with responsive scoped CSS in
   `public/index.html`.
4. Wire those DOM surfaces through `public/app.js` without changing upload polling,
   activity fetching, video selection, synchronization, rendering, or download
   behavior.
5. Derive bounded, sorted near misses from existing relevant collectibles and
   route distance in `src/activity.ts`, using existing geometry infrastructure.
6. Extend activity and replay tests using pure helpers rather than screenshot
   infrastructure.

## Acceptance criteria

1. Available and collected collectibles are visibly distinct, and collected
   locations remain understandable.
2. Collection events create visible, non-pausing feedback.
3. Score and count update at event time and finish at the canonical total.
4. The event feed uses human-readable collectible names rather than IDs.
5. Rarity is visible only as presentation metadata and has a textual signal.
6. Coin and landmark markers are subtly distinct without different game logic.
7. Full route, completed progress, and rider are easy to distinguish.
8. A compact completion state appears, including for zero-collectible rides.
9. The next-item indicator uses only existing relevant world data and adds no
   navigation behavior.
10. The replay remains dependency-free and keeps only Play, Pause, and Restart.
11. Existing world query/detection, FIT-only flow, and optional video flow retain
   their behavior.
12. No gameplay, scoring, progression, persistence, or social mechanics are added.
13. Near misses exclude collected collectibles, use only the existing relevant
    subset, are limited to five closest route-distance targets, and never create
    gameplay events.

## Validation

- Test available → collecting → collected mapping.
- Test rarity class/label mapping, including omitted rarity.
- Test coin/landmark presentation mapping.
- Test event-feed name preference over internal ID.
- Test next-item selection and distance from already relevant event/source data.
- Test event-time score change, final-score equality, zero-collectible state, and
  replay completion state.
- Test collected-event fallback visibility when world sources are filtered/absent.
- Test collected exclusion, 50 m and 200 m near-miss thresholds, over-threshold
  exclusion, ascending order, five-item cap, zero-list presentation, and unchanged
  score/count.
- Run focused replay tests, `npm run build`, and `npm test`.

## Constraints

Do not change collectible detection, scoring rules, world-query padding, GameEvent
semantics, synchronization, HighlightPlan, video rendering, job lifecycle,
persistence, or progression. `ActivityResult.nearMisses` is derived presentation
data only.

Do not add dependencies, map tiles/SDKs, WebGL, Three.js, animation frameworks,
particle systems, scrubber/speed/editing/export controls, sharing, or a shared
browser/video rendering implementation.
