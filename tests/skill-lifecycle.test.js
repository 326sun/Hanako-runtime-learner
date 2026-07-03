import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { pruneSkillBackups, skillRenderFingerprint, writeSkillIfChanged } from "../lib/skill-lifecycle.js";

const tmpDir = path.join(os.tmpdir(), "skill-lifecycle-test-" + Date.now());

describe("skill lifecycle", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("snapshots only when content changes and caps history", () => {
    const skillPath = path.join(tmpDir, "plugin", "skills", "self-learning", "SKILL.md");
    const historyDir = path.join(tmpDir, "skill_history");

    assert.equal(writeSkillIfChanged(skillPath, "# Runtime Self-Learning\none\n", historyDir, { keep: 2 }).changed, true);
    assert.equal(writeSkillIfChanged(skillPath, "# Runtime Self-Learning\none\n", historyDir, { keep: 2 }).changed, false);
    assert.equal(fs.readdirSync(historyDir).filter((name) => name.endsWith("-SKILL.md")).length, 0);

    writeSkillIfChanged(skillPath, "# Runtime Self-Learning\ntwo\n", historyDir, { keep: 2 });
    writeSkillIfChanged(skillPath, "# Runtime Self-Learning\nthree\n", historyDir, { keep: 2 });
    writeSkillIfChanged(skillPath, "# Runtime Self-Learning\nfour\n", historyDir, { keep: 2 });

    const snapshots = fs.readdirSync(historyDir).filter((name) => name.endsWith("-SKILL.md"));
    assert.equal(snapshots.length, 2);
    assert.equal(fs.readFileSync(skillPath, "utf-8"), "# Runtime Self-Learning\nfour\n");
  });

  it("keeps distinct snapshots when writes land in the same millisecond", (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: 1765324800000 });
    const skillPath = path.join(tmpDir, "plugin", "skills", "self-learning", "SKILL.md");
    const historyDir = path.join(tmpDir, "skill_history");

    writeSkillIfChanged(skillPath, "# Runtime Self-Learning\none\n", historyDir, { keep: 10 });
    writeSkillIfChanged(skillPath, "# Runtime Self-Learning\ntwo\n", historyDir, { keep: 10 });
    writeSkillIfChanged(skillPath, "# Runtime Self-Learning\nthree\n", historyDir, { keep: 10 });

    const snapshots = fs.readdirSync(historyDir).filter((name) => name.endsWith("-SKILL.md")).sort();
    assert.equal(snapshots.length, 2);
    assert.equal(fs.readFileSync(path.join(historyDir, snapshots[0]), "utf-8"), "# Runtime Self-Learning\none\n");
    assert.equal(fs.readFileSync(path.join(historyDir, snapshots[1]), "utf-8"), "# Runtime Self-Learning\ntwo\n");
  });

  it("caps adjacent SKILL.md backup files", () => {
    const skillDir = path.join(tmpDir, "plugin", "skills", "self-learning");
    fs.mkdirSync(skillDir, { recursive: true });
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(skillDir, `SKILL.md.2026-06-08T00-00-0${i}-000Z.bak`), String(i));
    }
    pruneSkillBackups(skillDir, { keep: 2 });
    assert.deepEqual(
      fs.readdirSync(skillDir).filter((name) => name.endsWith(".bak")).sort(),
      [
        "SKILL.md.2026-06-08T00-00-03-000Z.bak",
        "SKILL.md.2026-06-08T00-00-04-000Z.bak",
      ],
    );
  });

  it("fingerprints skill render inputs stably and invalidates on relevant changes", () => {
    const patterns = [
      {
        id: "workflow:test",
        type: "workflow",
        status: "approved",
        score: 10,
        count: 2,
        desc: "repeat test command",
        fix: "run npm test",
        scope: { project: "hanako", taskType: "code" },
        lastSeen: "2026-06-30T00:00:00.000Z",
      },
    ];
    const config = { minInjectScore: 8, maxSkillTokens: 2000 };

    assert.equal(
      skillRenderFingerprint(patterns, config, { turnCount: 4, dataDir: tmpDir }),
      skillRenderFingerprint(patterns, { maxSkillTokens: 2000, minInjectScore: 8 }, { turnCount: 4, dataDir: tmpDir }),
    );
    assert.notEqual(
      skillRenderFingerprint(patterns, config, { turnCount: 4, dataDir: tmpDir }),
      skillRenderFingerprint([{ ...patterns[0], desc: "repeat check command" }], config, { turnCount: 4, dataDir: tmpDir }),
    );
    assert.notEqual(
      skillRenderFingerprint(patterns, config, { turnCount: 4, dataDir: tmpDir }),
      skillRenderFingerprint(patterns, { ...config, minInjectScore: 10 }, { turnCount: 4, dataDir: tmpDir }),
    );
    assert.equal(
      skillRenderFingerprint(patterns, { ...config, modelAdvisorApiKey: "secret-a" }, { turnCount: 4, dataDir: tmpDir }),
      skillRenderFingerprint(patterns, { ...config, modelAdvisorApiKey: "secret-b" }, { turnCount: 4, dataDir: tmpDir }),
    );
  });

  it("includes active skill registry stat only when active skill injection is enabled", async () => {
    const dataDir = path.join(tmpDir, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    const file = path.join(dataDir, "active_skills.json");
    fs.writeFileSync(file, JSON.stringify({ skills: [] }), "utf-8");
    const config = { activeSkillsInjectionEnabled: true };
    const before = skillRenderFingerprint([], config, { dataDir });

    await new Promise((resolve) => setTimeout(resolve, 20));
    fs.writeFileSync(file, JSON.stringify({ skills: [{ id: "x" }] }), "utf-8");

    assert.notEqual(skillRenderFingerprint([], config, { dataDir }), before);
    assert.equal(
      skillRenderFingerprint([], { activeSkillsInjectionEnabled: false }, { dataDir }),
      skillRenderFingerprint([], { activeSkillsInjectionEnabled: false }, { dataDir }),
    );
  });
});
