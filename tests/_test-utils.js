// Unwrap tool results from v0.341+ structured format back to a plain string
// for backwards-compatible test assertions.
export function unwrapToolResult(result) {
  if (typeof result === "string") return result;
  if (result?.content?.[0]?.text) return result.content[0].text;
  return JSON.stringify(result);
}

export function parseToolResult(result) {
  return JSON.parse(unwrapToolResult(result));
}
