export class UserInputError extends Error {}

export class JourneyBoundaryError extends Error {
  readonly code = "ACTIVITY_BEFORE_JOURNEY_START";

  constructor() {
    super("This activity is from before your Staza journey began and can't be imported.");
    this.name = "JourneyBoundaryError";
  }
}
