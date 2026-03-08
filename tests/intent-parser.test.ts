import assert from "node:assert/strict";

import { parseNaturalLanguageToIntent } from "../core/intent-parser.js";

const tests = [
  {
    name: "parses profile intent",
    fn: () => {
      const intent = parseNaturalLanguageToIntent("get my facebook profile");
      assert.equal(intent.action, "get");
      assert.equal(intent.target, "profile");
      assert.equal(intent.risk, "LOW");
    }
  },
  {
    name: "parses post creation intent",
    fn: () => {
      const intent = parseNaturalLanguageToIntent('create post "Hello team" page 12345');
      assert.equal(intent.action, "create");
      assert.equal(intent.target, "post");
      assert.equal(intent.params.message, "Hello team");
      assert.equal(intent.params.pageId, "12345");
      assert.equal(intent.risk, "MEDIUM");
    }
  },
  {
    name: "parses ads list intent",
    fn: () => {
      const intent = parseNaturalLanguageToIntent("list ads account act_123");
      assert.equal(intent.action, "list");
      assert.equal(intent.target, "ads");
      assert.equal(intent.params.adAccountId, "act_123");
      assert.equal(intent.risk, "LOW");
    }
  },
  {
    name: "throws on unsupported phrasing",
    fn: () => {
      assert.throws(
        () => parseNaturalLanguageToIntent("maybe do something with instagram"),
        /Unable to parse intent deterministically/
      );
    }
  }
];

export default tests;

