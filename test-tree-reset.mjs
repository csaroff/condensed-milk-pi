#!/usr/bin/env node
/**
 * Regression scenarios for branch/tree navigation with static-cutoff masking.
 *
 * A user explores a long branch until condensed-milk enters its highest
 * pressure zone, then navigates back near the root. Message indices on the
 * active branch become small again. The first large Read result created on
 * that branch is new evidence and must remain visible to the model.
 *
 * A second scenario exercises the defense-in-depth path: even if Pi misses
 * the lifecycle event, clamping a stale cutoff to a short branch must persist.
 * Otherwise the old absolute cutoff expands again as the branch grows and
 * repeatedly treats newly appended results as historical.
 */
import * as compressorModule from "./index.ts";

// index.ts is CommonJS-shaped when this package (which has no `type: module`)
// is loaded through tsx from an .mjs test.
const tokenCompressor = compressorModule.default?.default ?? compressorModule.default;
const LONG_OUTPUT = "new branch evidence\n".repeat(20);

function userMsg(text) {
  return { role: "user", content: [{ type: "text", text }] };
}

function assistantRead(id, path) {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id, name: "read", arguments: { path } }],
  };
}

function readResult(id, output = LONG_OUTPUT) {
  return {
    role: "toolResult",
    toolName: "read",
    toolCallId: id,
    isError: false,
    content: [{ type: "text", text: output }],
  };
}

function readTurn(label) {
  const id = `read-${label}`;
  return [
    userMsg(`inspect ${label}`),
    assistantRead(id, `/tmp/${label}.txt`),
    readResult(id),
  ];
}

function buildLongBranch(turns = 50) {
  return Array.from({ length: turns }, (_, i) => readTurn(`old-${i}`)).flat();
}

function visibleText(messages, index) {
  return messages[index].content.find((block) => block.type === "text")?.text;
}

async function createHarness() {
  const handlers = new Map();
  const pi = {
    on(event, handler) {
      const registered = handlers.get(event) ?? [];
      registered.push(handler);
      handlers.set(event, registered);
    },
    registerCommand() {},
  };

  tokenCompressor(pi);

  let contextUsage = 0;
  const ctx = {
    ui: { setStatus() {} },
    getContextUsage() {
      return { tokens: contextUsage * 100_000, contextWindow: 100_000 };
    },
  };

  async function emit(event, payload = {}) {
    let result;
    for (const handler of handlers.get(event) ?? []) {
      result = await handler(payload, ctx);
    }
    return result;
  }

  async function sendContext(messages, usage) {
    contextUsage = usage;
    const result = await emit("context", { messages });
    return result?.messages ?? messages;
  }

  await emit("session_start", { reason: "startup" });
  return { emit, sendContext };
}

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}: ${detail}`);
  }
}

console.log("Scenario 1: navigating from a long branch to the root starts a new positional history");
{
  const harness = await createHarness();
  await harness.sendContext(buildLongBranch(), 0.70);

  await harness.emit("session_tree", {
    oldLeafId: "long-branch-leaf",
    newLeafId: "root",
  });

  const freshBranch = readTurn("fresh-after-tree");
  const visible = await harness.sendContext(freshBranch, 0.10);
  const output = visibleText(visible, 2);

  check(
    "the first large Read result after /tree remains visible",
    output === LONG_OUTPUT,
    `model received ${JSON.stringify(output)}`,
  );
}

console.log("\nScenario 2: a defensive cutoff clamp remains bounded as a short branch grows");
{
  const harness = await createHarness();
  await harness.sendContext(buildLongBranch(), 0.70);

  // Simulate a branch shrink whose lifecycle event was missed. The first pass
  // may conservatively mask the short branch, but it must persist that clamp.
  const shortBranch = readTurn("existing-at-shrink");
  await harness.sendContext(shortBranch, 0.10);

  const growingBranch = [...shortBranch, ...readTurn("fresh-while-growing")];
  const visible = await harness.sendContext(growingBranch, 0.10);
  const output = visibleText(visible, 5);

  check(
    "the stale absolute cutoff does not expand over newly appended results",
    output === LONG_OUTPUT,
    `model received ${JSON.stringify(output)}`,
  );
}

if (failures > 0) {
  console.error(`\nFAIL — ${failures} tree-navigation regression scenario(s) failed.`);
  process.exit(1);
}

console.log("\nPASS — tree navigation keeps fresh tool evidence visible.");
