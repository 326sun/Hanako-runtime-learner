// Live config refresh primitives.
//
// The plugin keeps a single in-memory `config` object that many subsystems hold
// by reference: PatternDetector (this.config), the refreshSkill/autoApprove
// closures, the advisor/extraction runners (getConfig: () => config) and the
// observer (configRef.current). To apply a settings-panel change live we update
// that object in place — replacing its identity would leave those holders on the
// old snapshot. See index.js refreshConfigFromPanel and the host event
// `plugin_config_changed` (core/plugin-manager.ts) that triggers the refresh.

/**
 * Replace the contents of `target` with `next` WITHOUT changing `target`'s
 * object identity, so every existing reference holder observes the update.
 * @param {object} target the live config object held by consumers
 * @param {object} next    the fully resolved next config
 * @returns {object} the same `target` object, mutated
 */
export function replaceConfigInPlace(target, next) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, next);
  return target;
}

/**
 * Converge all in-memory config views onto `next`: mutate the shared `config`
 * object in place, repoint `configRef.current` at it, and push it into the
 * detector via setConfig. configRef and detector are optional.
 * @param {{ config: object, configRef?: { current: object }, detector?: { setConfig?: Function } }} views
 * @param {object} next the fully resolved next config
 * @returns {object} the shared config object
 */
export function applyLiveConfig({ config, configRef, detector }, next) {
  replaceConfigInPlace(config, next);
  if (configRef) configRef.current = config;
  if (detector && typeof detector.setConfig === "function") detector.setConfig(config);
  return config;
}
