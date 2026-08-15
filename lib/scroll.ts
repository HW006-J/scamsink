/**
 * Pure decision logic for "should a scrollable panel auto-follow new
 * content." Extracted from the transcript panel so it's testable without a
 * real layout engine (jsdom doesn't compute scrollHeight/clientHeight).
 */
export function isNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  thresholdPx: number = 80,
): boolean {
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  return distanceFromBottom < thresholdPx;
}
