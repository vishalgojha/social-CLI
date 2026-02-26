import assert from "node:assert/strict";

import type { TuiTestCase } from "../parser/intent-parser.test.js";
import { buildActionBarHint, isApprovalPhase } from "./action-bar.js";

export const actionBarTests: TuiTestCase[] = [
  {
    name: "approval phase hint emphasizes approve/reject controls",
    fn: () => {
      const hint = buildActionBarHint({
        phase: "APPROVAL",
        hasIntent: true,
        verboseMode: false
      });
      assert.match(hint, /approve/i);
      assert.match(hint, /reject/i);
    }
  },
  {
    name: "idle phase hint offers common commands",
    fn: () => {
      const hint = buildActionBarHint({
        phase: "INPUT",
        hasIntent: false,
        verboseMode: false
      });
      assert.match(hint, /status/i);
      assert.match(hint, /doctor/i);
      assert.match(hint, /what can you do/i);
    }
  },
  {
    name: "isApprovalPhase covers approval-related states only",
    fn: () => {
      assert.equal(isApprovalPhase("APPROVAL"), true);
      assert.equal(isApprovalPhase("HIGH_RISK_APPROVAL"), true);
      assert.equal(isApprovalPhase("EDIT_SLOTS"), true);
      assert.equal(isApprovalPhase("INPUT"), false);
    }
  }
];
