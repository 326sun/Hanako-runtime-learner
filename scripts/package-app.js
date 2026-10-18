import path from "node:path";
import { runAppAuthorTool, projectRoot } from "./app-author-tools.js";
runAppAuthorTool("extension-pack.mjs", ["--kind", "app", "--dir", path.join(projectRoot, "dist-app", "hanako-runtime-learner"),
  "--publisher", "Sun", "--out", path.join(projectRoot, "release-v2")]);
