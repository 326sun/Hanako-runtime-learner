import crypto from "crypto";

export const TASK_GRAPH_NODES = Object.freeze({
  OBSERVE: "ObserveNode",
  PLAN: "PlanNode",
  POLICY: "PolicyNode",
  SCOPE: "ScopeNode",
  EXECUTE: "ExecuteNode",
  VERIFY: "VerifyNode",
  REPAIR: "RepairNode",
  ROLLBACK: "RollbackNode",
  FEEDBACK: "FeedbackNode",
  LEARN: "LearnNode",
  HUMAN_APPROVAL: "HumanApprovalNode",
  FINALIZE: "FinalizeNode",
});

const DEFAULT_NODE_ORDER = Object.freeze([
  TASK_GRAPH_NODES.OBSERVE,
  TASK_GRAPH_NODES.PLAN,
  TASK_GRAPH_NODES.POLICY,
  TASK_GRAPH_NODES.SCOPE,
  TASK_GRAPH_NODES.EXECUTE,
  TASK_GRAPH_NODES.VERIFY,
  TASK_GRAPH_NODES.FEEDBACK,
  TASK_GRAPH_NODES.LEARN,
  TASK_GRAPH_NODES.FINALIZE,
]);

function stableId(prefix, payload) {
  return `${prefix}:${crypto.createHash("sha256").update(JSON.stringify(payload || {})).digest("hex").slice(0, 12)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeNode(node, index = 0) {
  if (typeof node === "string") {
    return {
      id: node,
      type: node,
      title: node,
      index,
      dependencies: index === 0 ? [] : [DEFAULT_NODE_ORDER[index - 1]].filter(Boolean),
      status: "pending",
    };
  }
  const id = node.id || node.type || stableId("node", { index, node });
  return {
    id,
    type: node.type || id,
    title: node.title || node.type || id,
    index,
    dependencies: Array.isArray(node.dependencies) ? [...node.dependencies] : [],
    status: node.status || "pending",
    ...node,
  };
}

function linkLinear(nodes) {
  return nodes.map((node, index) => ({
    ...node,
    dependencies: index === 0 ? [] : (node.dependencies?.length ? node.dependencies : [nodes[index - 1].id]),
  }));
}

export function createTaskGraph(input = {}) {
  const taskId = input.taskId || stableId("task", { title: input.title, type: input.type, objective: input.objective });
  const nodeSource = input.nodes?.length ? input.nodes : DEFAULT_NODE_ORDER;
  const nodes = linkLinear(nodeSource.map(normalizeNode));
  return {
    schemaVersion: 1,
    graphId: input.graphId || stableId("task_graph", { taskId, nodes: nodes.map((n) => n.id) }),
    taskId,
    title: input.title || input.objective || input.type || "runtime task",
    riskTier: input.riskTier || "R2",
    nodes,
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

export function nextGraphNode(graph = {}, currentNodeId) {
  const nodes = graph.nodes || [];
  if (!currentNodeId) return nodes[0] || null;
  const index = nodes.findIndex((node) => node.id === currentNodeId || node.type === currentNodeId);
  return index >= 0 ? nodes[index + 1] || null : null;
}

export function markGraphNode(graph = {}, nodeId, status, extra = {}) {
  const next = clone(graph);
  next.nodes = (next.nodes || []).map((node) => (
    node.id === nodeId || node.type === nodeId
      ? { ...node, ...extra, status, updatedAt: new Date().toISOString() }
      : node
  ));
  return next;
}

export function readyGraphNodes(graph = {}) {
  const nodes = graph.nodes || [];
  const completed = new Set(nodes.filter((node) => ["completed", "skipped"].includes(node.status)).map((node) => node.id));
  return nodes.filter((node) => node.status === "pending" && (node.dependencies || []).every((dep) => completed.has(dep)));
}

export function validateTaskGraph(graph = {}) {
  const errors = [];
  if (!graph.taskId) errors.push("taskId missing");
  const nodes = graph.nodes || [];
  if (!nodes.length) errors.push("nodes missing");
  const ids = new Set();
  for (const node of nodes) {
    if (!node.id) errors.push("node id missing");
    if (ids.has(node.id)) errors.push(`duplicate node id: ${node.id}`);
    ids.add(node.id);
  }
  for (const node of nodes) {
    for (const dep of node.dependencies || []) {
      if (!ids.has(dep)) errors.push(`unknown dependency ${dep} for ${node.id}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
