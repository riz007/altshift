import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProject, type TestProject } from "../test/project.js";
import { Agent, type ModelClient } from "./agent.js";
import { UnknownPriceError } from "./pricing.js";
import { EditSession } from "./session.js";
import type { ToolContext } from "./tools/index.js";

const MODEL = "claude-fable-5-2";
const FILE = "app/components/CartDrawer.vue";
const usage = { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

let nextId = 0;
const call = (name: string, input: unknown) => ({ type: "tool_use", id: `toolu_${nextId++}`, name, input });
const reply = (content: unknown[], stop_reason = "tool_use") =>
  ({ model: MODEL, content, stop_reason, usage }) as unknown as Anthropic.Message;
const edit = call.bind(null, "propose_edit");

/** A model that plays back fixed replies and records every request it was sent. */
function scripted(replies: Anthropic.Message[]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: ModelClient = async (request) => {
    requests.push(structuredClone(request));
    const next = replies.shift();
    if (!next) throw new Error("the scripted model ran out of replies");
    return next;
  };
  return { client, requests };
}

let project: TestProject;
let context: ToolContext;
beforeEach(async () => {
  project = await createProject();
  context = { session: new EditSession(project.policy), findings: new Map(), designTokens: { cssVariables: {} } };
});
afterEach(() => project.remove());

const agent = (client: ModelClient, extra = {}) =>
  new Agent({ client, model: MODEL, system: "system prompt", budgetUsd: 1, ...extra });
const LABEL = {
  path: FILE,
  oldString: 'class="close"',
  newString: 'class="close" aria-label="Close cart"',
  rationale: "name it",
};
const FINISH = { summary: "Named the close button.", needsHumanReview: true };

describe("Agent", () => {
  it("reads, stages an edit and finishes", async () => {
    const model = scripted([
      reply([{ type: "thinking", thinking: "", signature: "sig" }, call("read_file", { path: FILE })]),
      reply([edit(LABEL)]),
      reply([call("finish", FINISH)]),
    ]);

    const stop = await agent(model.client).start(context, "Fix the close button.");

    expect(stop).toEqual({ reason: "finish", end: { kind: "finish", ...FINISH } });
    expect(context.session.changes()[0]?.after).toContain('aria-label="Close cart"');
    expect(model.requests).toHaveLength(3);
  });

  it("sends only the allowed tools, and keeps thinking blocks in the history", async () => {
    const model = scripted([
      reply([{ type: "thinking", thinking: "", signature: "sig" }, call("read_file", { path: FILE })]),
      reply([call("give_up", { reason: "x" })]),
    ]);
    await agent(model.client).start(context, "task");

    const second = model.requests[1];
    expect(second?.tools?.map((tool) => (tool as Anthropic.Tool).name)).toEqual([
      "list_files",
      "read_file",
      "search",
      "get_finding",
      "get_design_tokens",
      "propose_edit",
      "finish",
      "give_up",
    ]);
    expect(second?.messages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "thinking", signature: "sig" }, { type: "tool_use" }],
    });
    expect(second?.messages[2]).toMatchObject({ role: "user", content: [{ type: "tool_result", is_error: false }] });
    expect(second?.tool_choice).toBeUndefined();
    expect(second).not.toHaveProperty("thinking");
  });

  it("answers every tool call of a turn in one message", async () => {
    const model = scripted([
      reply([
        call("read_file", { path: FILE }),
        call("read_file", { path: ".env" }),
        call("run_shell", { command: "id" }),
      ]),
      reply([call("give_up", { reason: "x" })]),
    ]);
    await agent(model.client).start(context, "task");

    const results = model.requests[1]?.messages[2]?.content as Anthropic.ToolResultBlockParam[];
    expect(results.map((result) => result.is_error)).toEqual([false, true, true]);
    expect(JSON.stringify(results)).not.toContain("do-not-read");
  });

  it("stops when the model gives up", async () => {
    const model = scripted([reply([call("give_up", { reason: "Needs a design decision." })])]);
    expect(await agent(model.client).start(context, "task")).toEqual({
      reason: "give_up",
      message: "Needs a design decision.",
    });
  });

  it("reports a refusal without running any tool", async () => {
    const model = scripted([reply([edit(LABEL)], "refusal")]);
    const stop = await agent(model.client).start(context, "task");
    expect(stop.reason).toBe("refusal");
    expect(context.session.edits).toEqual([]);
  });

  it("reports a cut-off reply", async () => {
    const model = scripted([reply([], "max_tokens")]);
    expect((await agent(model.client).start(context, "task")).reason).toBe("max_tokens");
  });

  it("reminds once, then stops, when the model ends without finish or give_up", async () => {
    const text = [{ type: "text", text: "All done!" }];
    const model = scripted([reply(text, "end_turn"), reply(text, "end_turn")]);
    const stop = await agent(model.client).start(context, "task");

    expect(stop.reason).toBe("error");
    expect(model.requests[1]?.messages.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringContaining("finish"),
    });
  });

  it("stops at the turn limit", async () => {
    const model = scripted(Array.from({ length: 3 }, () => reply([call("read_file", { path: FILE })])));
    const stop = await agent(model.client, { maxTurns: 3 }).start(context, "task");
    expect(stop.reason).toBe("max_turns");
    expect(model.requests).toHaveLength(3);
  });

  it("meters cost from usage and stops when the budget is spent", async () => {
    const model = scripted(Array.from({ length: 5 }, () => reply([call("read_file", { path: FILE })])));
    // Each reply costs 1000 x $8/M + 100 x $40/M = $0.012.
    const run = agent(model.client, { budgetUsd: 0.02 });
    const stop = await run.start(context, "task");

    expect(stop.reason).toBe("budget");
    expect(model.requests).toHaveLength(2);
    expect(run.costUsd).toBeCloseTo(0.024, 6);
  });

  it("refuses to start with a model that has no price", () => {
    expect(
      () => new Agent({ client: scripted([]).client, model: "claude-unknown-9", system: "", budgetUsd: 1 }),
    ).toThrow(UnknownPriceError);
  });

  it("resumes the same conversation with the gate's verdict as the answer to finish", async () => {
    const model = scripted([
      reply([edit(LABEL), call("finish", FINISH)]),
      reply([call("give_up", { reason: "Cannot satisfy the gate." })]),
    ]);
    const run = agent(model.client);
    expect((await run.start(context, "task")).reason).toBe("finish");

    const stop = await run.resume(context, "The safety gate failed.");

    expect(stop.reason).toBe("give_up");
    const answer = model.requests[1]?.messages.at(-1)?.content as Anthropic.ToolResultBlockParam[];
    expect(answer).toHaveLength(2);
    expect(answer[1]).toMatchObject({ type: "tool_result", is_error: true, content: "The safety gate failed." });
  });
});
