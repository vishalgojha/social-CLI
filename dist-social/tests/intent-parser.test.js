"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const intent_parser_js_1 = require("../core/intent-parser.js");
const tests = [
    {
        name: "parses profile intent",
        fn: () => {
            const intent = (0, intent_parser_js_1.parseNaturalLanguageToIntent)("get my facebook profile");
            strict_1.default.equal(intent.action, "get");
            strict_1.default.equal(intent.target, "profile");
            strict_1.default.equal(intent.risk, "LOW");
        }
    },
    {
        name: "parses post creation intent",
        fn: () => {
            const intent = (0, intent_parser_js_1.parseNaturalLanguageToIntent)('create post "Hello team" page 12345');
            strict_1.default.equal(intent.action, "create");
            strict_1.default.equal(intent.target, "post");
            strict_1.default.equal(intent.params.message, "Hello team");
            strict_1.default.equal(intent.params.pageId, "12345");
            strict_1.default.equal(intent.risk, "MEDIUM");
        }
    },
    {
        name: "parses ads list intent",
        fn: () => {
            const intent = (0, intent_parser_js_1.parseNaturalLanguageToIntent)("list ads account act_123");
            strict_1.default.equal(intent.action, "list");
            strict_1.default.equal(intent.target, "ads");
            strict_1.default.equal(intent.params.adAccountId, "act_123");
            strict_1.default.equal(intent.risk, "LOW");
        }
    },
    {
        name: "throws on unsupported phrasing",
        fn: () => {
            strict_1.default.throws(() => (0, intent_parser_js_1.parseNaturalLanguageToIntent)("maybe do something with instagram"), /Unable to parse intent deterministically/);
        }
    }
];
exports.default = tests;
