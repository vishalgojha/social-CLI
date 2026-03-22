import type { AppPhase } from "../types.js";

export type ActionBarState = {
  phase: AppPhase;
  hasIntent: boolean;
  hasReplaySuggestions?: boolean;
  verboseMode?: boolean;
};

export function isApprovalPhase(phase: AppPhase): boolean {
  return phase === "APPROVAL" || phase === "HIGH_RISK_APPROVAL" || phase === "EDIT_SLOTS";
}

export function buildActionBarHint(state: ActionBarState): string {
  const replayHint = state.hasReplaySuggestions ? " | up/down suggestions" : "";
  const verboseHint = state.verboseMode ? " | d hide diagnostics" : " | d show diagnostics";

  if (state.phase === "HIGH_RISK_APPROVAL") {
    return `high-risk action: type reason + Enter | r reject | e edit${replayHint}${verboseHint}`;
  }

  if (state.phase === "APPROVAL" || state.phase === "EDIT_SLOTS") {
    return `pending action: Enter/y approve | n/r reject | e edit slots${replayHint}${verboseHint}`;
  }

  if (state.phase === "EXECUTING") {
    return `executing action... | r reject queue item${verboseHint}`;
  }

  if (state.phase === "RESULT" || state.phase === "REJECTED") {
    return `Enter continue | / palette | ? help${verboseHint}`;
  }

  return `try: ask naturally | status | doctor | waba setup | /help | /ai <intent>${replayHint}${verboseHint}`;
}
