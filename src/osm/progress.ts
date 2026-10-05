export type OSMProgressScope = "wikidata" | "import";

export interface OSMProgressEvent {
  scope: OSMProgressScope;
  message: string;
}

export type OSMProgressListener = (event: OSMProgressEvent) => void;

const timestamp = (value: Date): string => `${value.toISOString().slice(11, 19)}Z`;

/**
 * Formats progress events as `[12:00:00Z] [wikidata] message` UTC lines so long
 * pacing and retry waits remain visible while the importer runs.
 */
export const createProgressLogger = (
  write: (line: string) => void,
  now: () => Date = () => new Date()
): OSMProgressListener => (event) => {
  write(`[${timestamp(now())}] [${event.scope}] ${event.message}`);
};
