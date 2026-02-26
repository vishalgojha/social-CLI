import assert from "node:assert/strict";

import type { TuiTestCase } from "../parser/intent-parser.test.js";
import { handleShortcut } from "./tui-event-handlers.js";

function handlerFlags() {
  return {
    help: false,
    refresh: false,
    details: false,
    edit: false,
    approve: false,
    reject: false,
    rail: false,
    palette: false,
    confirm: false,
    replayUp: false,
    replayDown: false,
    quit: false
  };
}

function handlers(flags: ReturnType<typeof handlerFlags>) {
  return {
    onHelpToggle: () => { flags.help = true; },
    onRefresh: () => { flags.refresh = true; },
    onDetails: () => { flags.details = true; },
    onEdit: () => { flags.edit = true; },
    onApprove: () => { flags.approve = true; },
    onReject: () => { flags.reject = true; },
    onToggleRail: () => { flags.rail = true; },
    onPaletteToggle: () => { flags.palette = true; },
    onConfirm: () => { flags.confirm = true; },
    onReplayUp: () => { flags.replayUp = true; },
    onReplayDown: () => { flags.replayDown = true; },
    onQuit: () => { flags.quit = true; }
  };
}

export const shortcutHandlerTests: TuiTestCase[] = [
  {
    name: "typing draft in input phase does not trigger edit shortcut",
    fn: () => {
      const flags = handlerFlags();
      const consumed = handleShortcut("e", {}, false, handlers(flags), {
        phase: "INPUT",
        hasDraftText: true
      });
      assert.equal(consumed, false);
      assert.equal(flags.edit, false);
    }
  },
  {
    name: "approval phase allows edit shortcut",
    fn: () => {
      const flags = handlerFlags();
      const consumed = handleShortcut("e", {}, false, handlers(flags), {
        phase: "APPROVAL",
        hasDraftText: false
      });
      assert.equal(consumed, true);
      assert.equal(flags.edit, true);
    }
  },
  {
    name: "typing draft in input phase does not trigger quit shortcut",
    fn: () => {
      const flags = handlerFlags();
      const consumed = handleShortcut("q", {}, false, handlers(flags), {
        phase: "INPUT",
        hasDraftText: true
      });
      assert.equal(consumed, false);
      assert.equal(flags.quit, false);
    }
  },
  {
    name: "slash opens palette when input draft is empty",
    fn: () => {
      const flags = handlerFlags();
      const consumed = handleShortcut("/", {}, false, handlers(flags), {
        phase: "INPUT",
        hasDraftText: false
      });
      assert.equal(consumed, true);
      assert.equal(flags.palette, true);
    }
  },
  {
    name: "high-risk reason phase blocks approve shortcut",
    fn: () => {
      const flags = handlerFlags();
      const consumed = handleShortcut("a", {}, false, handlers(flags), {
        phase: "HIGH_RISK_APPROVAL",
        hasDraftText: true
      });
      assert.equal(consumed, false);
      assert.equal(flags.approve, false);
    }
  }
];
