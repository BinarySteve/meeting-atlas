export type TimedSegment = { startMs: number; endMs: number };

export function findActiveTimedSegment<T extends TimedSegment>(segments: readonly T[], currentMs: number): T | undefined {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const segment = segments[middle];
    if (currentMs < segment.startMs) high = middle - 1;
    else if (currentMs >= segment.endMs) low = middle + 1;
    else return segment;
  }
  return undefined;
}
