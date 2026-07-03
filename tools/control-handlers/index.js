// Aggregates every domain handler module into a single CONTROL_HANDLERS table
// (S2.P2d split — subsystem-simplify-v5.1.6). tools/control.js imports only
// this module for handler bodies, instead of importing each domain module
// individually — keeping the router's import list from re-growing as new
// handler domains are added.

import { statusHandlers } from "./status.js";
import { proposalReviewHandlers } from "./proposal-review.js";
import { maintenanceHandlers } from "./maintenance.js";
import { skillPolicyHandlers } from "./skill-policy.js";
import { eventHandlers } from "./events.js";
import { agentTaskHandlers } from "./agent-tasks.js";
import { auditHandlers } from "./audit.js";
import { transferHandlers } from "./transfer.js";

export const CONTROL_HANDLERS = Object.freeze({
  ...statusHandlers,
  ...proposalReviewHandlers,
  ...maintenanceHandlers,
  ...skillPolicyHandlers,
  ...eventHandlers,
  ...agentTaskHandlers,
  ...auditHandlers,
  ...transferHandlers,
});
