#!/usr/bin/env node
/**
 * The masking explainer must compose with Pi's structured system prompt.
 *
 * Pi treats a `systemPrompt` returned from `before_agent_start` as a forced
 * replacement of the whole prompt. Sections that later handlers add, such as
 * Pi's `mcp_servers` list, then never reach the model, so the agent cannot
 * tell which codemode MCP servers exist. The explainer belongs in its own
 * named section instead.
 */
import assert from "node:assert/strict";
import * as compressorModule from "./index.ts";

const tokenCompressor = compressorModule.default?.default ?? compressorModule.default;

const handlers = new Map();
tokenCompressor({
  on(event, handler) {
    handlers.set(event, [...(handlers.get(event) ?? []), handler]);
  },
  registerCommand() {},
});

function startRun() {
  // Pi rebuilds the structured options for every run.
  const event = { systemPrompt: "base", systemPromptOptions: { sections: {} } };
  let result;
  for (const handler of handlers.get("before_agent_start") ?? []) {
    result = handler(event, {}) ?? result;
  }
  return { event, result };
}

const first = startRun();
assert.equal(first.result?.systemPrompt, undefined, "must not force the whole system prompt");
assert.match(first.event.systemPromptOptions.sections.condensed_milk, /\[cm-masked bash\|read\]/);

// Identical bytes every run keep the cached prompt prefix stable.
assert.equal(startRun().event.systemPromptOptions.sections.condensed_milk, first.event.systemPromptOptions.sections.condensed_milk);

console.log("system prompt section: PASS");
