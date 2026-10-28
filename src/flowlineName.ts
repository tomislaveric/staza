const UNNAMED_FLOWLINE = "Unnamed Flowline";

const cleanPart = (value: string): string | undefined => {
  const cleaned = value
    .split(";")
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0 && piece !== "?")
    .join(" / ");
  return cleaned.length > 0 ? cleaned : undefined;
};

/**
 * Turns raw OSM-derived Flowline names ("Hayna -> Hayna", "Gochsheim -> ?", "B 35;B 293") into
 * something a player can read, with a fallback when the data is incomplete.
 */
export const readableFlowlineName = (rawName: string | undefined | null): string => {
  const raw = rawName?.trim();
  if (!raw) return UNNAMED_FLOWLINE;
  const parts = raw.split("->").map(cleanPart);
  if (parts.length === 1) return parts[0] ?? UNNAMED_FLOWLINE;
  const [start, end] = [parts[0], parts[parts.length - 1]];
  if (start && end) return start === end ? `Around ${start}` : `${start} \u2192 ${end}`;
  if (start) return `Leaving ${start}`;
  if (end) return `Towards ${end}`;
  return UNNAMED_FLOWLINE;
};
