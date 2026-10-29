/** One duration format for every screen: "1h 5m" / "42m" (minutes rounded). */
export const formatDuration = (seconds) => {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};
