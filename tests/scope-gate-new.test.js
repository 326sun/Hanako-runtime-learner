import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";

import {
  buildDiffPreview,
  evaluateScopeGate,
  previewAndGate,
  SCOPE_DECISION,
  defaultTaskScope,
  SECURITY_CRITICAL_FILES,
  MANDATORY_MANUAL_CONFIRM_FILES,
} from "../lib/scope-gate.js";

const tmpDir = path.join(os.tmpdir(), "learner-scope-gate-test-" + Date.now());

describe("scope-gate: buildDiffPreview", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("generates diff preview for skill_patch", () => {
    const proposal = {
      id: "proposal:skill1",
      type: "skill_patch",
      target: { skillPath: "skills/test.md" },
      patch: { content: "# New Skill\n\nTest content here" },
    };
    
    const preview = buildDiffPreview(proposal, { workspaceRoot: tmpDir });
    assert.equal(preview.ok, true);
    assert.equal(preview.type, "skill_patch");
    assert.equal(preview.target, "skills/test.md");
    assert.ok(preview.addedLines > 0);
    assert.equal(preview.files.length, 1);
  });

  it("generates diff preview for config_patch", () => {
    const proposal = {
      id: "proposal:config1",
      type: "config_patch",
      target: { configPath: "config.json" },
      patch: { config: { testOption: true } },
    };
    
    const preview = buildDiffPreview(proposal, { workspaceRoot: tmpDir, configPath: "config.json" });
    assert.equal(preview.ok, true);
    assert.equal(preview.type, "config_patch");
    assert.equal(preview.target, "config.json");
    assert.ok(preview.addedLines > 0);
  });

  it("generates diff preview for code_patch with filePatches", () => {
    const proposal = {
      id: "proposal:code1",
      type: "code_patch",
      patch: {
        filePatches: [
          { path: "src/index.js", oldText: "const a = 1;", newText: "const a = 2;" },
          { path: "src/utils.js", oldText: "", newText: "export const helper = 1;\n" },
        ],
      },
    };
    
    const preview = buildDiffPreview(proposal, { workspaceRoot: tmpDir });
    assert.equal(preview.ok, true);
    assert.equal(preview.files.length, 2);
    assert.ok(preview.summary.startsWith("2 files changed"));
  });

  it("counts oldText/newText patch lines instead of only diff-marker lines", () => {
    const proposal = {
      id: "proposal:line-count",
      type: "code_patch",
      patch: {
        filePatches: [
          {
            path: "src/big.js",
            oldText: "const oldA = 1;\nconst oldB = 2;\n",
            newText: "const newA = 1;\nconst newB = 2;\nconst newC = 3;\n",
          },
        ],
      },
    };

    const preview = buildDiffPreview(proposal, { workspaceRoot: tmpDir });
    assert.equal(preview.ok, true);
    assert.equal(preview.addedLines, 3);
    assert.equal(preview.removedLines, 2);
    assert.deepEqual(
      { addedLines: preview.files[0].addedLines, removedLines: preview.files[0].removedLines },
      { addedLines: 3, removedLines: 2 },
    );
  });

  it("marks path traversal patch targets as unsafe for the scope gate", () => {
    const proposal = {
      id: "proposal:path-traversal",
      type: "code_patch",
      patch: { fileWrites: [{ path: "../outside.js", content: "export const outside = true;\n" }] },
    };

    const preview = buildDiffPreview(proposal, { workspaceRoot: tmpDir });
    const result = evaluateScopeGate(proposal, preview, defaultTaskScope());
    assert.equal(preview.files[0].changeType, "unsafe");
    assert.equal(result.decision, SCOPE_DECISION.REJECT);
    assert.ok(result.violations.some((v) => v.includes("path escapes workspace")));
  });

  it("detects security critical files", () => {
    const proposal = {
      id: "proposal:secure1",
      type: "code_patch",
      patch: {
        filePatches: [
          { path: ".env", oldText: "", newText: "KEY=value" },
        ],
      },
    };
    
    const preview = buildDiffPreview(proposal, { workspaceRoot: tmpDir });
    assert.equal(preview.ok, true);
    assert.equal(preview.securityCritical, true);
  });

  it("detects requiresDocsUpdate for README changes", () => {
    const proposal = {
      id: "proposal:docs1",
      type: "skill_patch",
      target: { skillPath: "README.md" },
      patch: { content: "# Updated" },
    };
    
    const preview = buildDiffPreview(proposal, { workspaceRoot: tmpDir });
    assert.equal(preview.ok, true);
    assert.equal(preview.requiresDocsUpdate, true);
  });

  it("handles action_plan without file changes", () => {
    const proposal = {
      id: "proposal:action1",
      type: "action_plan",
      plan: { actionType: "NO_RETRY_DIAGNOSE", steps: [] },
    };
    
    const preview = buildDiffPreview(proposal, { workspaceRoot: tmpDir });
    assert.equal(preview.ok, true);
    assert.equal(preview.target, "NO_RETRY_DIAGNOSE");
    assert.equal(preview.files.length, 0);
  });

  it("rejects unknown proposal types", () => {
    const proposal = { id: "proposal:unknown", type: "unknown_type" };
    const preview = buildDiffPreview(proposal, { workspaceRoot: tmpDir });
    assert.equal(preview.ok, false);
    assert.ok(preview.error.includes("unsupported"));
  });
});

describe("scope-gate: evaluateScopeGate", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("allows normal code_patch within scope", () => {
    const proposal = { id: "p1", type: "code_patch" };
    const preview = { ok: true, files: [{ path: "lib/test.js", addedLines: 10, removedLines: 2 }], addedLines: 10, removedLines: 2 };
    const scope = defaultTaskScope();
    
    const result = evaluateScopeGate(proposal, preview, scope);
    assert.equal(result.decision, SCOPE_DECISION.ALLOW);
  });

  it("rejects security-critical file changes", () => {
    const proposal = { id: "p2", type: "code_patch" };
    const preview = { ok: true, files: [{ path: ".env", addedLines: 1, removedLines: 0 }], addedLines: 1, removedLines: 0 };
    const scope = defaultTaskScope();
    
    const result = evaluateScopeGate(proposal, preview, scope);
    assert.equal(result.decision, SCOPE_DECISION.REJECT);
    assert.ok(result.violations.some((v) => v.includes("security-critical")));
  });

  it("requires manual confirm for package.json", () => {
    const proposal = { id: "p3", type: "code_patch" };
    const preview = { ok: true, files: [{ path: "package.json", addedLines: 5, removedLines: 0 }], addedLines: 5, removedLines: 0 };
    const scope = defaultTaskScope();
    
    const result = evaluateScopeGate(proposal, preview, scope);
    assert.equal(result.decision, SCOPE_DECISION.MANUAL_CONFIRM);
    assert.ok(result.warnings.some((w) => w.includes("manual confirm")));
  });

  it("requires manual confirm for repository-boundary files such as workflows", () => {
    const proposal = { id: "p3b", type: "code_patch" };
    const preview = {
      ok: true,
      files: [{ path: ".github/workflows/ci.yml", addedLines: 3, removedLines: 1 }],
      addedLines: 3,
      removedLines: 1,
    };

    const result = evaluateScopeGate(proposal, preview, defaultTaskScope());
    assert.equal(result.decision, SCOPE_DECISION.MANUAL_CONFIRM);
    assert.ok(result.warnings.some((w) => w.includes("repository-boundary")));
    assert.ok(result.riskEscalations.includes("R3"));
  });

  it("rejects when exceeding maxChangedFiles", () => {
    const proposal = { id: "p4", type: "code_patch" };
    const preview = { ok: true, files: Array(15).fill({ path: "file.js", addedLines: 1, removedLines: 0 }), addedLines: 15, removedLines: 0 };
    const scope = { maxChangedFiles: 10 };
    
    const result = evaluateScopeGate(proposal, preview, scope);
    assert.equal(result.decision, SCOPE_DECISION.MANUAL_CONFIRM);
    assert.ok(result.violations.some((v) => v.includes("maxChangedFiles")));
  });

  it("rejects when exceeding maxAddedLines", () => {
    const proposal = { id: "p5", type: "code_patch" };
    const preview = { ok: true, files: [{ path: "big.js", addedLines: 600, removedLines: 0 }], addedLines: 600, removedLines: 0 };
    const scope = { maxAddedLines: 500 };
    
    const result = evaluateScopeGate(proposal, preview, scope);
    assert.equal(result.decision, SCOPE_DECISION.MANUAL_CONFIRM);
    assert.ok(result.violations.some((v) => v.includes("maxAddedLines")));
  });

  it("enforces allowedFiles restriction", () => {
    const proposal = { id: "p6", type: "code_patch" };
    const preview = { ok: true, files: [{ path: "lib/test.js", addedLines: 5, removedLines: 0 }], addedLines: 5, removedLines: 0 };
    const scope = { allowedFiles: ["config.json"], allowedDirs: [] };
    
    const result = evaluateScopeGate(proposal, preview, scope);
    assert.equal(result.decision, SCOPE_DECISION.REJECT);
    assert.ok(result.violations.some((v) => v.includes("not in allowed scope")));
  });

  it("allows files in allowedDirs", () => {
    const proposal = { id: "p7", type: "code_patch" };
    const preview = { ok: true, files: [{ path: "lib/utils/helper.js", addedLines: 5, removedLines: 0 }], addedLines: 5, removedLines: 0 };
    const scope = { allowedFiles: [], allowedDirs: ["lib"] };

    const result = evaluateScopeGate(proposal, preview, scope);
    assert.equal(result.decision, SCOPE_DECISION.ALLOW);
  });

  it("does not let a bare suffix bypass allowedFiles boundaries", () => {
    const proposal = { id: "p6b", type: "code_patch" };
    const preview = { ok: true, files: [{ path: "evil-src/a.js", addedLines: 1, removedLines: 0 }], addedLines: 1, removedLines: 0 };
    const result = evaluateScopeGate(proposal, preview, { allowedFiles: ["src/a.js"], allowedDirs: [] });
    assert.equal(result.decision, SCOPE_DECISION.REJECT);
  });

  it("does not let a directory-name prefix bypass allowedDirs boundaries", () => {
    const proposal = { id: "p7b", type: "code_patch" };
    const preview = { ok: true, files: [{ path: "src-evil/x.js", addedLines: 1, removedLines: 0 }], addedLines: 1, removedLines: 0 };
    const result = evaluateScopeGate(proposal, preview, { allowedFiles: [], allowedDirs: ["src"] });
    assert.equal(result.decision, SCOPE_DECISION.REJECT);
  });

  it("still allows nested paths matching an allowedFiles entry on a segment boundary", () => {
    const preview = { ok: true, files: [{ path: "packages/app/src/a.js", addedLines: 1, removedLines: 0 }], addedLines: 1, removedLines: 0 };
    const result = evaluateScopeGate({ id: "p6c", type: "code_patch" }, preview, { allowedFiles: ["src/a.js"], allowedDirs: [] });
    assert.equal(result.decision, SCOPE_DECISION.ALLOW);
  });

  it("requires manual confirm for delete operations", () => {
    const proposal = { id: "p8", type: "code_patch" };
    const preview = { ok: true, files: [{ path: "old-file.js", changeType: "delete", addedLines: 0, removedLines: 10 }], addedLines: 0, removedLines: 10 };
    const scope = defaultTaskScope();
    
    const result = evaluateScopeGate(proposal, preview, scope);
    assert.equal(result.decision, SCOPE_DECISION.MANUAL_CONFIRM);
    assert.ok(result.violations.some((v) => v.includes("delete operation")));
  });

  it("allows action_plans with no file changes", () => {
    const proposal = { id: "p9", type: "action_plan" };
    const preview = { ok: true, files: [], addedLines: 0, removedLines: 0 };
    const scope = defaultTaskScope();
    
    const result = evaluateScopeGate(proposal, preview, scope);
    assert.equal(result.decision, SCOPE_DECISION.ALLOW);
  });

  it("escalates to R4 for security-critical files", () => {
    const proposal = { id: "p10", type: "code_patch" };
    const preview = { ok: true, files: [{ path: ".env", addedLines: 1, removedLines: 0 }], addedLines: 1, removedLines: 0 };
    const scope = defaultTaskScope();
    
    const result = evaluateScopeGate(proposal, preview, scope);
    assert.ok(result.riskEscalations.includes("R4"));
  });
});

describe("scope-gate: previewAndGate", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("combines diff preview and scope gate in one call", () => {
    const proposal = {
      id: "proposal:combined",
      type: "code_patch",
      patch: { filePatches: [{ path: "lib/test.js", oldText: "a", newText: "b" }] },
    };
    
    const result = previewAndGate(proposal, { workspaceRoot: tmpDir });
    
    assert.equal(result.ok, true);
    assert.ok(result.diffPreview);
    assert.ok(result.scopeGate);
    assert.equal(result.decision, SCOPE_DECISION.ALLOW);
  });

  it("returns ok=false for rejected security critical", () => {
    const proposal = {
      id: "proposal:secure",
      type: "code_patch",
      patch: { filePatches: [{ path: ".env", oldText: "", newText: "KEY=val" }] },
    };
    
    const result = previewAndGate(proposal, { workspaceRoot: tmpDir });
    
    assert.equal(result.ok, false);
    assert.equal(result.decision, SCOPE_DECISION.REJECT);
  });
});

describe("scope-gate: constants", () => {
  it("exports SECURITY_CRITICAL_FILES", () => {
    assert.ok(Array.isArray(SECURITY_CRITICAL_FILES));
    assert.ok(SECURITY_CRITICAL_FILES.includes(".env"));
  });

  it("exports MANDATORY_MANUAL_CONFIRM_FILES", () => {
    assert.ok(Array.isArray(MANDATORY_MANUAL_CONFIRM_FILES));
    assert.ok(MANDATORY_MANUAL_CONFIRM_FILES.includes("package.json"));
  });

  it("exports SCOPE_DECISION", () => {
    assert.equal(SCOPE_DECISION.ALLOW, "allow");
    assert.equal(SCOPE_DECISION.MANUAL_CONFIRM, "manual_confirm");
    assert.equal(SCOPE_DECISION.REJECT, "reject");
  });
});

describe("scope-gate: defaultTaskScope", () => {
  it("returns sensible defaults", () => {
    const scope = defaultTaskScope();
    assert.equal(scope.maxChangedFiles, 10);
    assert.equal(scope.maxAddedLines, 500);
    assert.equal(scope.maxRemovedLines, 200);
  });

  it("merges with config overrides", () => {
    const scope = defaultTaskScope({ maxChangedFiles: 5, allowedFiles: ["*.js"] });
    assert.equal(scope.maxChangedFiles, 5);
    assert.deepEqual(scope.allowedFiles, ["*.js"]);
  });
});