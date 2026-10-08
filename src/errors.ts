export class UserInputError extends Error {}

export type ActivityImportRejectionCode = "duplicate_activity" | "before_journey_start";

/** A valid activity that the canonical persistence transaction refused to accept. */
export class ActivityImportRejectedError extends Error {
  constructor(
    readonly code: ActivityImportRejectionCode,
    message: string,
    readonly details: { existingActivityId?: string; journeyStartedAt?: string } = {}
  ) {
    super(message);
  }
}
