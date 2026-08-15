/**
 * Conservative timing model for deciding when it's realistic to assume a
 * scripted TTS line has finished playing to the caller, plus a genuine
 * listening window before ScamSink may proactively continue.
 *
 * ConversationRelay's `last: true` on an outbound "text" message marks
 * only the final token of that turn's text — it is NOT proof that audible
 * TTS playback has finished. Checked Twilio's ConversationRelay docs for a
 * playback-complete signal before writing this: the WebSocket-messages
 * reference (the authoritative page for exactly this question) documents
 * five message types sent to the app server — setup, prompt, dtmf,
 * interrupt, error — and nothing else; no "tokens-played" or
 * playback-complete event exists in the current protocol. So this
 * estimates from word count instead of waiting for a signal that isn't
 * actually there.
 */

// Deliberately slower than typical natural/TTS speech (~150-180 wpm) so
// the estimate never UNDER-shoots real playback time, which would open
// the "human response" window too early and reproduce the original bug.
const WORDS_PER_MINUTE = 130;
const MS_PER_WORD = 60_000 / WORDS_PER_MINUTE;

// Small fixed cushion for TTS engine startup/network latency beyond pure
// word-count timing.
const PLAYBACK_SAFETY_BUFFER_MS = 800;

// Floor so even a very short line still gets a sane minimum playback estimate.
const MIN_ESTIMATED_PLAYBACK_MS = 1_500;

// Genuine listening window given to the human after estimated playback
// ends, before ScamSink may proactively continue on its own.
export const HUMAN_RESPONSE_GRACE_MS = 5_000;

export function estimatePlaybackMs(text: string): number {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const estimate = wordCount * MS_PER_WORD + PLAYBACK_SAFETY_BUFFER_MS;
  return Math.max(MIN_ESTIMATED_PLAYBACK_MS, Math.round(estimate));
}

/** Total delay, from the moment `text` is dispatched, before a proactive continuation may fire. */
export function estimateProactiveDelayMs(text: string): number {
  return estimatePlaybackMs(text) + HUMAN_RESPONSE_GRACE_MS;
}
