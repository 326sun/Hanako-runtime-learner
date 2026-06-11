import fs from "fs";
import readline from "readline";

async function pruneJsonlByDate(file, cutoff) {
  if (!fs.existsSync(file)) return false;
  const tmpFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  let total = 0;
  let kept = 0;

  try {
    const input = fs.createReadStream(file, { encoding: "utf-8" });
    const output = fs.createWriteStream(tmpFile, { encoding: "utf-8" });
    const rl = readline.createInterface({ input, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line) continue;
      total += 1;
      let keep = true;
      try {
        const row = JSON.parse(line);
        keep = !row.date || new Date(row.date).getTime() >= cutoff;
      } catch {}
      if (keep) {
        kept += 1;
        if (!output.write(`${line}\n`)) await new Promise((resolve) => output.once("drain", resolve));
      }
    }

    await new Promise((resolve, reject) => {
      output.end(resolve);
      output.on("error", reject);
    });

    if (kept < total) {
      await fs.promises.rename(tmpFile, file);
      return true;
    }
    await fs.promises.rm(tmpFile, { force: true });
  } catch {
    try { await fs.promises.rm(tmpFile, { force: true }); } catch {}
  }
  return false;
}

export function createJsonlRetentionPruner(files, {
  retentionDays = 30,
  minIntervalMs = 300_000,
} = {}) {
  let lastRunAt = 0;
  return async function pruneDataFiles() {
    const now = Date.now();
    if (now - lastRunAt < minIntervalMs) return;
    lastRunAt = now;
    const cutoff = now - retentionDays * 86_400_000;
    for (const file of files) await pruneJsonlByDate(file, cutoff);
  };
}
