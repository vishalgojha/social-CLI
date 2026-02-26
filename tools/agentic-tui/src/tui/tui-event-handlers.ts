import type { AppPhase } from "../types.js";

export interface ShortcutHandlers {
  onHelpToggle: () => void;
  onRefresh: () => void;
  onDetails: () => void;
  onEdit: () => void;
  onApprove: () => void;
  onReject: () => void;
  onToggleRail: () => void;
  onPaletteToggle: () => void;
  onConfirm: () => void;
  onReplayUp: () => void;
  onReplayDown: () => void;
  onQuit: () => void;
}

export interface ShortcutContext {
  phase: AppPhase;
  hasDraftText: boolean;
}

function isApprovalPhase(phase: AppPhase): boolean {
  return phase === "APPROVAL" || phase === "HIGH_RISK_APPROVAL";
}

export function handleShortcut(
  input: string,
  key: { ctrl?: boolean; return?: boolean; upArrow?: boolean; downArrow?: boolean; escape?: boolean },
  hasReplaySuggestions: boolean,
  handlers: ShortcutHandlers,
  context: ShortcutContext
): boolean {
  const phase = context.phase;
  const hasDraftText = Boolean(context.hasDraftText);
  const allowSingleKey = !hasDraftText && phase !== "HIGH_RISK_APPROVAL";

  if (key.ctrl && input === "c") {
    handlers.onQuit();
    return true;
  }
  if (input === "q" && allowSingleKey) {
    handlers.onQuit();
    return true;
  }
  if (input === "?" && allowSingleKey) {
    handlers.onHelpToggle();
    return true;
  }
  if (input === "u" && allowSingleKey) {
    handlers.onRefresh();
    return true;
  }
  if (input === "d" && allowSingleKey && phase !== "EDIT_SLOTS") {
    handlers.onDetails();
    return true;
  }
  if (input === "e" && allowSingleKey && phase === "APPROVAL") {
    handlers.onEdit();
    return true;
  }
  if (input === "a" && allowSingleKey && isApprovalPhase(phase)) {
    handlers.onApprove();
    return true;
  }
  if (input === "r" && allowSingleKey && (isApprovalPhase(phase) || phase === "EDIT_SLOTS")) {
    handlers.onReject();
    return true;
  }
  if (input === "x" && allowSingleKey) {
    handlers.onToggleRail();
    return true;
  }
  if (input === "/" && allowSingleKey && phase === "INPUT") {
    handlers.onPaletteToggle();
    return true;
  }
  if (hasReplaySuggestions && key.upArrow) {
    handlers.onReplayUp();
    return true;
  }
  if (hasReplaySuggestions && key.downArrow) {
    handlers.onReplayDown();
    return true;
  }
  if (key.return) {
    handlers.onConfirm();
    return true;
  }
  return false;
}

