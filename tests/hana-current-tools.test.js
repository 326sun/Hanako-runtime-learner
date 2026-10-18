import { it } from "node:test";
import assert from "node:assert/strict";
import { uniqueSortedToolCategories } from "../lib/pattern-detector-utils.js";
import { classifyTask } from "../lib/helpers.js";

it("classifies Hana 1.1 command and file tools for workflow learning", () => {
  assert.deepEqual(uniqueSortedToolCategories(["file", "exec_command", "write_stdin"]), ["文件探索", "终端操作"]);
  assert.equal(classifyTask(["exec_command", "edit"]), "coding");
  assert.equal(classifyTask(["file"]), "file_management");
});
