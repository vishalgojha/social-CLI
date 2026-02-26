import assert from "node:assert/strict";

import type { TuiTestCase } from "../parser/intent-parser.test.js";
import { detectDomainSkill } from "./domain-skills.js";

export const domainSkillTests: TuiTestCase[] = [
  {
    name: "routes WhatsApp wording to waba skill",
    fn: () => {
      const skill = detectDomainSkill("send whatsapp template to +15551234567", "unknown");
      assert.equal(skill.id, "waba");
    }
  },
  {
    name: "routes ad actions to marketing skill",
    fn: () => {
      const skill = detectDomainSkill("list ads account act_123", "list_ads");
      assert.equal(skill.id, "marketing");
    }
  },
  {
    name: "routes post actions to facebook skill",
    fn: () => {
      const skill = detectDomainSkill("create post launch update", "create_post");
      assert.equal(skill.id, "facebook");
    }
  },
  {
    name: "routes instagram language to instagram skill",
    fn: () => {
      const skill = detectDomainSkill("show instagram media insights", "unknown");
      assert.equal(skill.id, "instagram");
    }
  },
  {
    name: "routes setup/auth wording to setup-auth skill",
    fn: () => {
      const skill = detectDomainSkill("help me setup token and app secret", "unknown");
      assert.equal(skill.id, "setup-auth");
    }
  }
];
