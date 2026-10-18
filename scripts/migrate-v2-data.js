import { migrateLegacyData } from "../v2/migrate-data.js";
const args = process.argv.slice(2);
const source = args[args.indexOf("--source") + 1];
const target = args[args.indexOf("--target") + 1];
if (!args.includes("--source") || !args.includes("--target") || !source || !target) {
  throw new Error("Usage: node scripts/migrate-v2-data.js --source <v1-data-directory> --target <v2-app-data-directory> [--apply]. Disable v1 before applying. Default is read-only preview.");
}
console.log(JSON.stringify(migrateLegacyData({ source, target, apply: args.includes("--apply") }), null, 2));
