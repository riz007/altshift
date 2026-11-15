import type Anthropic from "@anthropic-ai/sdk";
import { FIX_EFFORT, MAX_OUTPUT_TOKENS } from "./models.js";
import { costUsd, requirePrice } from "./pricing.js";
import {
  runTool,
  toolDefinitions,
  type ToolContext,
  type ToolEnd,
} from "./tools/index.js";

/** One Messages API call. The real client and the recording player both fit this. */
export type ModelClient = (
  request: Anthropic.MessageCreateParamsNonStreaming,
) => Promise<Anthropic.Message>;

export type AgentStop =
  | { reason: "finish"; end: Extract<ToolEnd, { kind: "finish" }> }
  | { reason: "give_up"; message: string }
  | {
      reason: "refusal" | "max_turns" | "max_tokens" | "budget" | "error";
      message: string;
    };

export interface AgentOptions {
  client: ModelClient;
  model: string;
  system: string;
  /** Hard stop for this conversation, in USD. */
  budgetUsd: number;
  maxTurns?: number;
}

const DEFAULT_MAX_TURNS = 20;
// More than this in one turn is not how a small fix is found, and every result is paid for again on later turns.
const MAX_CALLS_PER_TURN = 8;

/**
 * A conversation with the fix model about one finding group. The model can only act through the tools,
 * and it ends by calling finish or give_up. `resume` continues the same conversation after a gate failure.
 */
export class Agent {
  costUsd = 0;
  private readonly messages: Anthropic.MessageParam[] = [];
  /** The finish call waiting for a verdict, with results for any calls made in the same turn. */
  private pending:
    | { finishId: string; others: Anthropic.ToolResultBlockParam[] }
    | undefined;
  private turns = 0;

  constructor(private readonly options: AgentOptions) {
    // A missing price must stop the run before the first call, not after money is spent.
    requirePrice(options.model);
  }

  start(context: ToolContext, userMessage: string): Promise<AgentStop> {
    this.messages.push({ role: "user", content: userMessage });
    return this.loop(context);
  }

  /** Answer the finish call that ended the last attempt with the gate's verdict, and let the model try again. */
  resume(context: ToolContext, feedback: string): Promise<AgentStop> {
    if (this.pending === undefined)
      throw new Error("resume() needs an attempt that ended with finish.");
    // Every tool call of a turn must be answered in one message.
    this.messages.push({
      role: "user",
      content: [
        ...this.pending.others,
        {
          type: "tool_result",
          tool_use_id: this.pending.finishId,
          content: feedback,
          is_error: true,
        },
      ],
    });
    this.pending = undefined;
    return this.loop(context);
  }

  private request(): Promise<Anthropic.Message> {
    return this.options.client({
      model: this.options.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      // Caches the growing conversation, so each turn pays full price only for what the last turn added.
      cache_control: { type: "ephemeral" },
      output_config: { effort: FIX_EFFORT },
      system: this.options.system,
      tools: toolDefinitions() as Anthropic.Tool[],
      messages: this.messages,
    });
  }

  private async loop(context: ToolContext): Promise<AgentStop> {
    const maxTurns = this.options.maxTurns ?? DEFAULT_MAX_TURNS;
    let reminded = false;

    while (this.turns < maxTurns) {
      if (this.costUsd >= this.options.budgetUsd)
        return {
          reason: "budget",
          message: "The budget for this group ran out.",
        };
      this.turns++;

      let response: Anthropic.Message;
      try {
        response = await this.request();
      } catch (error) {
        // A failed call ends this group, not the run: fixes already accepted and their cost must survive.
        return {
          reason: "error",
          message: `The model call failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      this.costUsd += costUsd(this.options.model, response.usage);

      if (response.stop_reason === "refusal")
        return {
          reason: "refusal",
          message: "The model declined this request.",
        };
      if (response.stop_reason === "max_tokens")
        return {
          reason: "max_tokens",
          message: "The model's reply was cut off.",
        };

      // Thinking blocks must go back unchanged, so the whole content is kept, not just the text.
      this.messages.push({ role: "assistant", content: response.content });
      const calls = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );

      if (calls.length === 0) {
        if (reminded)
          return {
            reason: "error",
            message: "The model stopped without calling finish or give_up.",
          };
        reminded = true;
        this.messages.push({
          role: "user",
          content:
            "End the task by calling finish (with staged edits) or give_up.",
        });
        continue;
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      let end: { id: string; value: ToolEnd } | undefined;
      for (const [index, call] of calls.entries()) {
        if (index >= MAX_CALLS_PER_TURN) {
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: `Not run: at most ${MAX_CALLS_PER_TURN} tool calls per turn.`,
            is_error: true,
          });
          continue;
        }
        // Once the model has ended the task, later calls in the same turn are not run.
        if (end !== undefined) {
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: "Not run: the task had already ended.",
            is_error: true,
          });
          continue;
        }
        const result = await runTool(context, call.name, call.input);
        if (result.end !== undefined) end = { id: call.id, value: result.end };
        else
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: result.content,
            is_error: result.isError,
          });
      }

      if (end === undefined) {
        this.messages.push({ role: "user", content: results });
        continue;
      }
      if (end.value.kind === "give_up")
        return { reason: "give_up", message: end.value.reason };

      // The finish call stays open until resume() answers it with the gates' verdict.
      this.pending = { finishId: end.id, others: results };
      return { reason: "finish", end: end.value };
    }
    return {
      reason: "max_turns",
      message: `The model did not finish within ${maxTurns} turns.`,
    };
  }
}

/** The real client. Reads ANTHROPIC_API_KEY from the environment. */
export async function anthropicClient(): Promise<ModelClient> {
  const { default: AnthropicSdk } = await import("@anthropic-ai/sdk");
  const sdk = new AnthropicSdk();
  return (request) => sdk.messages.create(request);
}
