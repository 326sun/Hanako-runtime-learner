// Event-log read-only control handlers (C-001 HANDLERS split — events domain).
//
// Extracted verbatim from tools/control.js. Pure read handlers: they take
// (input, p), read the event log under p.learnerDir, and return a JSON string.
// They mutate nothing and own NO permission/side-effect decisions — control.js
// keeps the action dispatch, the *_ACTIONS classification sets,
// describeControlSideEffect and sessionPermission. This module only implements
// the handler bodies and is spread back into the control HANDLERS table under
// the same action names.

import { readEvents, replayEventState, verifyEventLog } from "../../lib/event-log.js";

export const eventHandlers = {
  list_events(input, p) {
    return JSON.stringify({ ok: true, events: readEvents(p.learnerDir, { limit: input.limit || 50, entityId: input.id || null }) }, null, 2);
  },

  event_summary(input, p) {
    const events = readEvents(p.learnerDir, { limit: input.limit || 5000, entityId: input.id || null });
    return JSON.stringify({ ok: true, summary: replayEventState(events) }, null, 2);
  },

  verify_event_log(input, p) {
    const result = verifyEventLog(p.learnerDir);
    return JSON.stringify({ ...result, nextAction: result.ok ? "export_audit_bundle or continue" : "inspect event_log.jsonl and restore from trusted backup" }, null, 2);
  },
};
