# account-and-user-data-deletion

## Goal

Ensure deleting an account removes all data owned by that user, including imported activities, so those activities can be imported again. Provide safe operator tooling to delete selected test users or purge all user-owned data without deleting shared world/catalog data.

## Scope and decisions

- Audit and correct the complete account-to-player deletion path, including dependent activity, quest, progression, authentication, and media records.
- Remove security-event rows for a deleted account rather than retaining them with a null user reference.
- Add cleanup modes for deleting selected users by email and purging all user-owned data.
- Preserve shared catalog data, including fartleks, collectibles (including mountain-pass collectibles), quest templates, and other shared world data.
- Block the new destructive cleanup modes when `NODE_ENV=production`.
- Preserve the existing `clean:activities` command's behavior and scope.

## Implementation plan

1. Verify the actual migration state and relationships on the affected database. Migration `022_cascade_player_data_deletion` enables cascades from players to activities and authored quests; determine whether it was applied where the activities remained and whether any existing records are orphaned or belong to a different player.
2. Audit all user/player-owned tables and media cleanup behavior. Correct schema or deletion logic only where necessary so deleting an account reliably removes its owned rows and associated security events.
3. Add focused persistence regression coverage for account deletion, including activity and related-data removal, preserved shared catalog rows, and the ability to re-import a deleted activity.
4. Add an operator cleanup CLI with explicit selected-user and full user-owned-data purge modes. Require confirmation, block production execution, perform database changes transactionally, preserve shared catalogs, and report the scope and counts removed.
5. Add an npm script for the new cleanup CLI without changing the existing `clean:activities` script.

## Acceptance criteria

- Account deletion leaves no user/player-owned activities or related records, including security events, and deletes associated media files using the existing safety checks.
- Activities removed with an account no longer block importing those activities again.
- Selected-user cleanup deletes only the selected account(s) and their owned data.
- Full purge removes user-owned data across accounts while retaining the shared catalog tables and their contents.
- Both cleanup modes refuse to run in production and require explicit operator confirmation.
- Existing activity-cleanup behavior and persistence tests continue to work.

## Validation

- Run the focused persistence/authentication tests against `TEST_DATABASE_URL`.
- Verify both cleanup modes with disposable test data, asserting that owned data is removed and shared catalogs remain unchanged.
- Verify production-mode refusal and confirmation cancellation do not delete data.
- Confirm the target database's `schema_migrations` includes migration `022` when investigating the reported leftover rows.
