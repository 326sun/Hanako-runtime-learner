import fs from "fs";
import { DEFAULT_CONFIG, writeJson, mergeConfig, applyPanelConfig } from "./common.js";
import { runtimeConfigPath, migrateRuntimeConfigFile } from "./runtime-config-path.js";
import { mergeCredentials, detectPlaintextCredentials, saveCredentials, loadCredentials, panelCredentialsToStore } from "./credentials.js";
import { applyLiveConfig } from "./live-config.js";

export function createRuntimeConfigPath(dataDir) {
  return runtimeConfigPath(dataDir);
}

function loadConfig(paths) {
  try {
    if (fs.existsSync(paths.CONFIG_FILE)) {
      const raw = fs.readFileSync(paths.CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      return { config: mergeConfig(parsed), source: "file" };
    }
  } catch (e) {
    if (e instanceof SyntaxError) {
      try { fs.renameSync(paths.CONFIG_FILE, `${paths.CONFIG_FILE}.corrupt.${Date.now()}.bak`); } catch {}
      try { writeJson(paths.CONFIG_FILE, DEFAULT_CONFIG); } catch {}
      return { config: mergeConfig(), source: "corrupt" };
    }
  }
  try { writeJson(paths.CONFIG_FILE, DEFAULT_CONFIG); } catch {}
  return { config: mergeConfig(), source: "default" };
}

export function loadRuntimeConfig(ctx, rt) {
  try {
    const migration = migrateRuntimeConfigFile(rt.paths.DATA_DIR);
    if (migration.migrated) {
      ctx.log.info(`runtime-learner: migrated legacy config.json to runtime-config.json (${migration.reason})`);
    }
  } catch {}

  const { config, source } = loadConfig(rt.paths);
  rt.config = config;
  rt.configSource = source;
  rt.timer.mark("config_load");
}

export function bridgePanelConfig(ctx, rt) {
  let config = rt.config;
  const preBridge = JSON.stringify(config);
  config = applyPanelConfig(config, ctx.config);
  let configNeedsPersist = JSON.stringify(config) !== preBridge;

  try {
    const panelCreds = panelCredentialsToStore(ctx.config);
    if (Object.keys(panelCreds).length > 0) {
      saveCredentials({ ...loadCredentials(), ...panelCreds });
      ctx.log.info(`runtime-learner: captured ${Object.keys(panelCreds).length} settings-panel credential(s) into the encrypted store`);
    }
  } catch {}

  try {
    const plaintextKeys = detectPlaintextCredentials(config);
    if (plaintextKeys.length > 0) {
      const toEncrypt = {};
      for (const key of plaintextKeys) toEncrypt[key] = config[key];
      saveCredentials(toEncrypt);
      for (const key of plaintextKeys) config[key] = "(stored in credentials.enc)";
      configNeedsPersist = true;
      ctx.log.info(`runtime-learner: migrated ${plaintextKeys.length} plaintext credential(s) to encrypted store`);
    }
  } catch {}

  if (configNeedsPersist) { try { writeJson(rt.paths.CONFIG_FILE, config); } catch {} }
  rt.config = mergeCredentials(config);
  rt.timer.mark("config_bridge_credentials");
}

export function wireLiveConfigAndDisposal(ctx, rt, runtimeState) {
  const refreshConfigFromPanel = () => {
    try {
      const bridged = applyPanelConfig(loadConfig(rt.paths).config, ctx.config);
      try { writeJson(rt.paths.CONFIG_FILE, bridged); } catch {}
      try {
        const panelCreds = panelCredentialsToStore(ctx.config);
        if (Object.keys(panelCreds).length > 0) saveCredentials({ ...loadCredentials(), ...panelCreds });
      } catch {}
      applyLiveConfig({ config: rt.config, configRef: rt.configRef, detector: rt.detector }, mergeCredentials(bridged));
      ctx.log.info("runtime-learner: applied live settings-panel config update");
    } catch (err) {
      ctx.log.warn(`runtime-learner: live config refresh skipped: ${err?.message || err}`);
    }
  };
  const unsubConfig = ctx.bus.subscribe?.((event) => {
    if (event?.type === "plugin_config_changed" && (!ctx.pluginId || event.pluginId === ctx.pluginId)) {
      refreshConfigFromPanel();
    }
  }, { types: ["plugin_config_changed"] });

  runtimeState.detector = rt.detector;
  runtimeState.sessions = rt.sessions;
  runtimeState.unsub = () => rt.observer.unsubscribe();
  runtimeState.persistPatterns = rt.flushPersist;
  runtimeState.refreshSkill = rt.refreshSkill;

  if (typeof rt.register === "function") {
    rt.register(() => { try { rt.observer.unsubscribe(); } catch {} });
    rt.register(() => { try { rt.persistSeenIds(true); } catch {} });
    rt.register(() => { try { rt.flushPersist(); } catch {} });
    if (typeof unsubConfig === "function") rt.register(() => { try { unsubConfig(); } catch {} });
  }
  rt.timer.mark("runtime_state_registered");
}
