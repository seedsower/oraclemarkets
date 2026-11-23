import { test } from "node:test";
import assert from "node:assert/strict";
import { argSets, idsIn, isReadOnly } from "./partner-mcp-discover";

test("isReadOnly: never ask/create/add/watch; lookups only", () => {
  const t = (name: string, description = "") => ({ name, description });
  assert.equal(
    isReadOnly(t("ask_question", "Refines the question and publishes a forecast")),
    false,
  );
  assert.equal(isReadOnly(t("add_to_watchlist")), false);
  assert.equal(isReadOnly(t("create_prediction")), false);
  assert.equal(isReadOnly(t("search_predictions", "Search existing questions")), true);
  assert.equal(isReadOnly(t("get_prediction", "Get one prediction by id")), true);
  assert.equal(isReadOnly(t("list_categories")), true);
  assert.equal(
    isReadOnly(t("get_status", "Creates a new question if missing")),
    false,
    "description says it writes",
  );
  assert.equal(isReadOnly(t("whoami")), false, "not a lookup tool");
});

test("argSets: category, limit, status, query and sort variants from the schema", () => {
  const tool = {
    name: "search_predictions",
    inputSchema: {
      type: "object" as const,
      properties: {
        category: { type: "string", enum: ["politics", "crypto"] },
        query: { type: "string" },
        limit: { type: "number" },
        sort: { type: "string", enum: ["popular", "new"] },
      },
    },
  };
  const sets = argSets(tool as never, "Crypto");
  assert.deepEqual(sets[0], { category: "crypto", limit: 20 });
  assert.ok(sets.some((s) => s.sort === "popular") && sets.some((s) => s.sort === "new"));
});

test("idsIn: ids from structured content and JSON text, not prose", () => {
  assert.deepEqual(idsIn({ structuredContent: { results: [{ id: "q1" }, { id: 2 }] } }).sort(), [
    "2",
    "q1",
  ]);
  assert.deepEqual(idsIn({ content: [{ type: "text", text: '[{"question_id":"abc"}]' }] }), [
    "abc",
  ]);
  assert.deepEqual(idsIn({ content: [{ type: "text", text: "Here are some questions…" }] }), []);
});
