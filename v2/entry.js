import { defineApp } from "@hana/app-sdk/server";
import { startApp } from "./runtime.js";

export default defineApp(async (sdk) => {
  const app = await startApp(sdk);
  const stop = async () => { await app.stop(); process.exit(0); };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
});
