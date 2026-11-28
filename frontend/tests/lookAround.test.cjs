const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

const loaded = {};
new Function(
  "exports",
  ts.transpileModule(fs.readFileSync("src/lookAround.ts", "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText,
)(loaded);
const { lookedEnough } = loaded;

test("location is asked after 4 swipes, 7 map touches or 3 of each, whichever first", () => {
  // [swipes, map touches, ask?]
  for (const [swipes, map, ask] of [
    [0, 0, false],
    [3, 0, false],
    [4, 0, true],
    [0, 6, false],
    [0, 7, true],
    [3, 2, false],
    [2, 3, false],
    [3, 3, true],
    [2, 6, false],
    [1, 6, false],
    [5, 1, true],
    [2, 8, true],
  ])
    assert.equal(
      lookedEnough(swipes, map),
      ask,
      `${swipes} swipes, ${map} map touches`,
    );
});
