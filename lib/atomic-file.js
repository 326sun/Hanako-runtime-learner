import fs from "fs";
import path from "path";

export function atomicWriteFileSync(file, content, encoding = "utf-8") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  let fd = null;
  try {
    fd = fs.openSync(tmp, "w");
    fs.writeFileSync(fd, content, encoding);
    // Make the replacement durable on filesystems that support POSIX fsync.
    // Windows may provide weaker directory-flush semantics; rename is still
    // atomic there, so this is a best-effort durability upgrade, not a claim
    // of power-loss atomicity on every host filesystem.
    try { fs.fsyncSync(fd); } catch {}
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, file);
    try {
      const dirFd = fs.openSync(path.dirname(file), "r");
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch {}
  } catch (err) {
    if (fd != null) try { fs.closeSync(fd); } catch {}
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw err;
  }
}
