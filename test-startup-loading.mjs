#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const entrypoint = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

// Pi loads every extension before drawing the editor. Filter implementations
// are only needed once Bash starts returning output, so startup must not pull
// their registration graph into the entrypoint synchronously.
assert.deepEqual(
  [...entrypoint.matchAll(/^import "\.\/filters\/[^\"]+\.js";$/gm)].map((match) => match[0]),
  [],
);
assert.match(entrypoint, /import\("\.\/filters\/pytest\.js"\)/);
assert.match(entrypoint, /await ensureFiltersLoaded\(\)/);

console.log("startup loading: PASS");
