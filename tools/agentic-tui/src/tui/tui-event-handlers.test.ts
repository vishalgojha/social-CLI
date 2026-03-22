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
    guide: false,
    nextAction: false,
    logs: false,
    openItem: -1,
    quickAction: -1,
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
    onGuide: () => { flags.guide = true; },
    onNextAction: () => { flags.nextAction = true; },
    onLogs: () => { flags.logs = true; },
    onOpenItem: (index: number) => { flags.openItem = index; },
    onQuickAction: (index: number) => { flags.quickAction = index; },
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
    name: "approval phase accepts y to approve",
    fn: () => {
      const flags = handlerFlags();
      const consumed = handleShortcut("y", {}, false, handlers(flags), {
        phase: "APPROVAL",
        hasDraftText: false
      });
      assert.equal(consumed, true);
      assert.equal(flags.approve, true);
    }
  },
  {
    name: "approval phase accepts n to reject",
    fn: () => {
      const flags = handlerFlags();
      const consumed = handleShortcut("n", {}, false, handlers(flags), {
        phase: "APPROVAL",
        hasDraftText: false
      });
      assert.equal(consumed, true);
      assert.equal(flags.reject, true);
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
    name: "g triggers guided setup when input draft is empty",
    fn: () => {
      const flags = handlerFlags();
      const consumed = handleShortcut("g", {}, false, handlers(flags), {
        phase: "INPUT",
        hasDraftText: false
      });
      assert.equal(consumed, true);
      assert.equal(flags.guide, true);
    }
  },
  {
    name: "n triggers next action when input draft is empty",
    fn: () => {
      const flags = handlerFlags();
      const consumed = handleShortcut("n", {}, false, handlers(flags), {
        phase: "INPUT",
        hasDraftText: false
      });
      assert.equal(consumed, true);
      assert.equal(flags.nextAction, true);
    }
  },
  {
    name: "l triggers logs when input draft is empty",
    fn: () => {
      const flags = handlerFlags();
      const consumed = handleShortcut("l", {}, false, handlers(flags), {
        phase: "INPUT",
        hasDraftText: false
      });
      assert.equal(consumed, true);
      assert.equal(flags.logs, true);
    }
  },
  {
    name: "numeric key triggers quick action when input draft is empty",
    fn: () => {
      const flags = handlerFlags();
      const consumed = handleShortcut("2", {}, false, handlers(flags), {
        phase: "INPUT",
        hasDraftText: false,
        openItemsCount: 0
      });
      assert.equal(consumed, true);
      assert.equal(flags.quickAction, 1);
    }
  },
  {
    name: "numeric key targets open item when present",
    fn: () => {
      const flags = handlerFlags();
      const consumed = handleShortcut("1", {}, false, handlers(flags), {
        phase: "INPUT",
        hasDraftText: false,
        openItemsCount: 2
      });
      assert.equal(consumed, true);
      assert.equal(flags.openItem, 0);
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
