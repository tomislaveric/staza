# quest-ui-optimization

## Goal

Make local quest recommendations and tracked quest cards easier to scan and
understand while preserving quest behavior. Reuse the World map's Flowline and
Mountain Pass visual vocabulary, normalize card height and hierarchy, and reduce
the visual weight of Start actions.

## Scope

- Add World-style Flowline line and Mountain Pass icons to quest objective rows.
- Give recommendation and tracked quest cards a consistent, equal-height layout
  that safely accommodates longer content.
- De-emphasize and consistently position the Start quest action.
- Initially show up to three local recommendations, with an accessible control
  to reveal or hide the remaining suggestions.
- Keep unstarted recommendation cards compact: title, description, inline
  icon-and-type chips for objectives, then Start. Do not repeat full objective
  prose already described in the card copy.
- For active Flowline objectives, show a Flowline indicator, completed/required
  count, and only completed Flowlines with their average speed.
- Keep mixed objectives distinct. Mountain Passes and completed quest cards
  retain their per-target status rows.
- Retain active and completed quest visibility, objective progress, Start,
  cancel, and current recommendation behavior.
- Make the purpose legible as optional guided exploration goals with visible
  progress and completion; describe quests as exploration challenges, not
  reward-bearing tasks.
- Update focused UI tests and the directly related default-quests documentation.

## Decisions

| Decision | Choice |
|---|---|
| Quest rewards and XP | No quest XP, rewards, or progression work. Existing activity XP remains unchanged. |
| Quest purpose | Guided exploration challenges with tracked objective progress and completion; no promised reward. |
| Recommendation density | Show up to three recommendations initially and allow users to reveal or hide the remaining recommendations. |
| Quest behavior | Preserve current recommendation, start, active progress, cancellation, and completion semantics. |
| Visual vocabulary | Reuse the existing World Flowline swatch and Mountain Pass collectible icon styles. |
| Start placement | Use flexible space after goal chips so Start buttons align across recommendation cards. |
| Target progress | Derive per-target completion from canonical history when listing instances; do not persist or accept client-supplied progress. |
| Active Flowline speed | Display the latest qualifying completion's average speed for every completed Flowline, including objectives without a speed threshold. |
| Running quest controls | Label the section "Your running Quests"; active cards use an accessible close icon for cancellation without an "Active" badge. Completed cards retain their completion status. |

## Implementation plan

1. Keep inactive recommendation cards concise and render active Flowline
   completion progress without listing incomplete candidate segments.
2. Style recommendation and tracked quest cards with consistent heights,
   responsive layouts, accessible focus states, and a less prominent Start
   action. Prevent long titles and objective text from overflowing or becoming
   inaccessible.
3. Add a show-more/show-less control for the recommendation list, initially
   showing up to three suggestions while keeping every generated suggestion
   reachable and preserving Start interactions.
4. Extend quest UI tests to cover icon markup, equal-height layout hooks,
   collapsed and expanded recommendations, and existing tracked-quest states.
   Update the default-quests feature documentation with the UI behavior and the
   no-rewards decision.
5. Run focused quest UI tests and the smallest relevant project validation.

## Acceptance criteria

- Active Flowline objectives show a blue line indicator and completed/required
  count; only completed segments appear below, with yellow indicators and
  average speed in km/h.
- Average speed is shown for every completed Flowline, even when speed is not
  an objective condition.
- Mountain Pass targets continue to use the existing World map-category glyph.
- Unstarted recommendations contain the quest title, description, one inline
  icon-and-type chip per objective, and Start, without a repeated objective
  checklist or level label.
- Start buttons align across unstarted cards, with the flexible spacer between
  the goal chips and the action.
- Mixed objectives remain separate. Non-Flowline active objectives and
  completed quests retain their aggregate progress and per-target status rows.
- Quest cards align to a consistent height and retain readable content without
  clipping or hiding longer text.
- Start remains easy to find and use, but no longer dominates a dense grid.
- Recommendation copy frames quests as optional exploration challenges and
  tracked progress, without promising rewards.
- Up to three recommendations are shown by default; all remaining items can be
  revealed and hidden through an accessible control.
- The tracked quest section is titled "Your running Quests." Active cards omit
  the "Active" badge and provide an accessible close icon that preserves the
  existing cancellation confirmation; completed cards retain their status.
- Active and completed quest progress and cancellation behavior remain intact.
- No quest XP, rewards, or progression changes are introduced.
- Focused quest UI tests pass.

## Constraints

- Preserve semantic lists, keyboard interaction, accessible labels, and escaping
  of user-controlled quest content.
- Keep all recommendations available; do not discard suggestions to reduce
  visual density.
- Do not collapse active or completed quest instances.
- Do not add rewards, XP, social quest sharing, an active-instance limit, or
  level-gated content.

## Validation

- Test active Flowline-only completed rows, average speed selection, and
  iconography, including mixed quests.
- Test that completed quest presentation is unchanged.
- Test that unstarted recommendations omit objective text already present in
  their descriptions.
- Test initial recommendation collapse, show-more/show-less state, and Start
  action availability.
- Preserve existing tests for started, active, cancelled, and completed quests.
- Run the focused quest UI test file and any directly relevant checks.
