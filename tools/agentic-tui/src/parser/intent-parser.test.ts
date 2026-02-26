import assert from "node:assert/strict";

import { parseNaturalLanguage } from "./intent-parser.js";

export type TuiTestCase = {
  name: string;
  fn: () => Promise<void> | void;
};

export const parserIntentTests: TuiTestCase[] = [
  {
    name: "casual greeting maps to status instead of unknown",
    fn: () => {
      const parsed = parseNaturalLanguage("hello");
      assert.equal(parsed.intent.action, "status");
      assert.equal(parsed.valid, true);
    }
  },
  {
    name: "capability question maps to help intent",
    fn: () => {
      const parsed = parseNaturalLanguage("what can you do");
      assert.equal(parsed.intent.action, "help");
      assert.equal(parsed.valid, true);
    }
  },
  {
    name: "non-casual unmatched text still returns unknown",
    fn: () => {
      const parsed = parseNaturalLanguage("maybe do something strange with numbers");
      assert.equal(parsed.intent.action, "unknown");
    }
  },
  {
    name: "chat input containing social hatch command maps to help",
    fn: () => {
      const parsed = parseNaturalLanguage("social hatch --verbose");
      assert.equal(parsed.intent.action, "help");
      assert.equal(parsed.valid, true);
    }
  },
  {
    name: "short conversational input maps to help instead of unknown",
    fn: () => {
      const parsed = parseNaturalLanguage("who");
      assert.equal(parsed.intent.action, "help");
      assert.equal(parsed.valid, true);
    }
  }
];
