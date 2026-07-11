import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

import { readJsonlTailLines } from "../lib/jsonl-utils.js";

function withTailFile(name, content, fn) {
  const file = path.join(os.tmpdir(), `${name}-${process.pid}.jsonl`);
  fs.writeFileSync(file, content, "utf-8");
  try { fn(file); } finally { fs.rmSync(file, { force: true }); }
}

describe("readJsonlTailLines boundaries", () => {
  it("keeps the first complete line when the tail window starts on a newline", () => {
    const padding = "z".repeat(1010);
    withTailFile("learner-tail-boundary", `${"x".repeat(10)}\nfirst\nsecond\n${padding}`, (file) => {
      assert.deepEqual(readJsonlTailLines(file, { maxLines: 10, initialBytes: 1024, maxBytes: 1024 }), ["first", "second", padding]);
    });
  });

  it("keeps a complete line when the tail window starts immediately after a newline", () => {
    const padding = "z".repeat(1011);
    withTailFile("learner-tail-after-boundary", `${"x".repeat(9)}\nfirst\nsecond\n${padding}`, (file) => {
      assert.deepEqual(readJsonlTailLines(file, { maxLines: 10, initialBytes: 1024, maxBytes: 1024 }), ["first", "second", padding]);
    });
  });
});
