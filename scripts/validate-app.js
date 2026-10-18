import path from "node:path";
import { runAppAuthorTool, projectRoot } from "./app-author-tools.js";
runAppAuthorTool("validate-app.mjs", ["--dir", path.join(projectRoot, "dist-app", "hanako-runtime-learner"), "--json", ...process.argv.slice(2)]);
