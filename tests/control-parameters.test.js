/**
 * Unit tests for tools/control-parameters.js — the parameter schema property
 * table extracted from tools/control.js (C-001 phase 3b).
 * Verifies the extracted properties and that control.js still composes an
 * equivalent schema (same fields, same required, action enum intact).
 * Run: node --test tests/control-parameters.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONTROL_PARAM_PROPERTIES } from "../tools/control-parameters.js";
import { parameters } from "../tools/control.js";

describe("CONTROL_PARAM_PROPERTIES", () => {
  it("contains the key non-action fields with unchanged shapes", () => {
    assert.deepEqual(CONTROL_PARAM_PROPERTIES.id, { type: "string", description: "Pattern id for approve/reject." });
    assert.deepEqual(CONTROL_PARAM_PROPERTIES.proposalId, { type: "string", description: "Proposal id for show/apply/reject proposal actions." });
    assert.deepEqual(CONTROL_PARAM_PROPERTIES.validationStatus, { type: "string", enum: ["passed", "failed"], description: "Target validation status for record_transfer_validation." });
    assert.deepEqual(CONTROL_PARAM_PROPERTIES.evidence, { type: "array", items: { type: "string" }, description: "Validation evidence lines for transfer registry actions." });
    assert.deepEqual(CONTROL_PARAM_PROPERTIES.format, { type: "string", enum: ["text", "json"], description: "Output format for the doctor action. Default text." });
    assert.deepEqual(CONTROL_PARAM_PROPERTIES.fast, { type: "boolean", description: "For doctor: skip deep log/event/MemFS/fact checks for a faster read-only health snapshot. Default false." });
    assert.deepEqual(CONTROL_PARAM_PROPERTIES.governanceProfile, { type: "string", enum: ["conservative", "balanced", "autonomous"], description: "Governance policy profile to apply." });
    assert.deepEqual(CONTROL_PARAM_PROPERTIES.semanticCacheMaxEntries, { type: "number" });
  });

  it("does NOT contain the action property (action stays in control.js)", () => {
    assert.equal("action" in CONTROL_PARAM_PROPERTIES, false);
  });
});

describe("control.js parameters schema after extraction", () => {
  it("keeps the top-level shape: object + required action", () => {
    assert.equal(parameters.type, "object");
    assert.deepEqual(parameters.required, ["action"]);
  });

  it("preserves the pre-extraction behavior of not declaring additionalProperties", () => {
    // The original schema had no `additionalProperties` key; adding one would be
    // a contract change, so extraction must leave it absent.
    assert.equal("additionalProperties" in parameters, false);
  });

  it("keeps the action property with its HANDLERS-derived enum", () => {
    assert.equal(parameters.properties.action.type, "string");
    assert.equal(parameters.properties.action.description, "Control action to run.");
    assert.ok(Array.isArray(parameters.properties.action.enum));
    assert.ok(parameters.properties.action.enum.includes("status"));
    assert.ok(parameters.properties.action.enum.includes("set_config"));
    assert.ok(parameters.properties.action.enum.length > 20);
  });

  it("lists action first, then every CONTROL_PARAM_PROPERTIES field in order", () => {
    const keys = Object.keys(parameters.properties);
    assert.equal(keys[0], "action");
    assert.deepEqual(keys.slice(1), Object.keys(CONTROL_PARAM_PROPERTIES));
  });

  it("references the extracted properties object (every non-action field present and identical)", () => {
    for (const [key, value] of Object.entries(CONTROL_PARAM_PROPERTIES)) {
      assert.deepEqual(parameters.properties[key], value, `field ${key} differs`);
    }
  });
});
