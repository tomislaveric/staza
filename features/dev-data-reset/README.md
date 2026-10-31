# dev-data-reset

## Goal
On localhost and the DEV stage only, let a signed-in user wipe all of their game data from the Profile page, so the import flow can be restarted. The login stays.

## Scope
- Deleted: activities, videos and media files, XP, points, achievements, quests and quest instances, and other player-owned progress.
- Kept: user, passkeys, sessions, Strava connection, settings.
- Not available in production.
- Out of scope: manual per-activity deletion, because XP and achievements cannot be cleanly reversed.

## Decisions
- Stage detection uses `NODE_ENV`: `production` is prod, `dev` is the DEV stage (`ops/app/docker-compose.dev.yml`), and `dev` is also the local default (`src/config.ts`). Anything other than `production` counts as dev.
- Keep the user, passkeys, Strava connection and settings; wipe everything else.
- The UI is a "DEVELOPMENT" section in the Profile below the Delete section, with a dev badge, an explanation and one button with a confirm step.

## Implementation plan
1. Add `resetPlayerData(pool, userId, mediaRoot)` in `src/persistence`, reusing the media-collection logic from `cleanUserData.ts`. It runs in one transaction, deletes all player-owned rows and keeps user and auth data, then removes media directories. Audit the schema for every player-owned table, and decide whether the player row is reset or kept.
2. Add `POST /api/dev/reset-data` behind `requirePlayer` and `requireCsrf`. It is not registered, or returns 404, when `config.nodeEnv === "production"`. Add an `isDevStage` config helper. Expose a `devTools` flag in an existing bootstrap or session payload.
3. Add the DEVELOPMENT section to `public/components/profile/profile-page.js`, with a confirm step, a state refresh afterwards, and EN/DE locale strings.
4. Add tests and a README note next to `clean:user-data`.

## Acceptance criteria
- A dev or local user can reset their data from Profile, and afterwards stays logged in with passkeys and the Strava connection intact.
- Activities, XP, points, achievements, quests and media are gone.
- In production the section is hidden and the endpoint is unavailable.
- Other users' data is untouched.

## Validation
- Vitest for the reset function (persistence test DB) and route gating (production returns 404).
- Profile UI test where one exists.
- Manual check on localhost.
