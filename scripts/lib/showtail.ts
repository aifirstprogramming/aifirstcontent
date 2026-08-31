/** Versioned Showtail report shapes used by the authoring importer. */

export interface ShowtailText {
  text: string;
  timestamp?: string;
}

export interface ShowtailV1ToolCall {
  toolName: string;
  text: string;
  timestamp?: string;
  isError?: boolean;
}

export interface ShowtailV2Event {
  sequence: number;
  timestamp?: string;
  type:
    | "assistant_text"
    | "user_text"
    | "tool_use"
    | "tool_result"
    | "plan_snapshot"
    | "plan_approved";
  text?: string;
  toolUseId?: string;
  toolName?: string;
  input?: unknown;
  content?: unknown;
  isError?: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  plan?: string;
}

export interface ShowtailTurn {
  prompt: ShowtailText;
  events?: ShowtailV2Event[];
  aiOutputs: ShowtailText[];
  codeChanges: Array<{ path: string; diff?: string; timestamp?: string }>;
  toolCalls: ShowtailV1ToolCall[];
}

export interface ShowtailReport {
  schemaVersion: 1 | 2;
  generatedAt: string;
  displayName: string;
  sessionId?: string;
  turns: ShowtailTurn[];
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function text(value: unknown, label: string): ShowtailText {
  const item = record(value, label);
  if (typeof item.text !== "string")
    throw new Error(`${label}.text must be a string`);
  return {
    text: item.text,
    ...(optionalString(item.timestamp)
      ? { timestamp: item.timestamp as string }
      : {}),
  };
}

function v2Event(value: unknown, label: string): ShowtailV2Event {
  const item = record(value, label);
  const allowed = new Set([
    "assistant_text",
    "user_text",
    "tool_use",
    "tool_result",
    "plan_snapshot",
    "plan_approved",
  ]);
  if (!Number.isInteger(item.sequence) || (item.sequence as number) < 0)
    throw new Error(`${label}.sequence must be a non-negative integer`);
  if (typeof item.type !== "string" || !allowed.has(item.type))
    throw new Error(`${label}.type is unsupported`);
  return {
    sequence: item.sequence as number,
    type: item.type as ShowtailV2Event["type"],
    ...(optionalString(item.timestamp)
      ? { timestamp: item.timestamp as string }
      : {}),
    ...(optionalString(item.text) ? { text: item.text as string } : {}),
    ...(optionalString(item.toolUseId)
      ? { toolUseId: item.toolUseId as string }
      : {}),
    ...(optionalString(item.toolName)
      ? { toolName: item.toolName as string }
      : {}),
    ...(item.input === undefined ? {} : { input: item.input }),
    ...(item.content === undefined ? {} : { content: item.content }),
    ...(typeof item.isError === "boolean" ? { isError: item.isError } : {}),
    ...(optionalString(item.stdout) ? { stdout: item.stdout as string } : {}),
    ...(optionalString(item.stderr) ? { stderr: item.stderr as string } : {}),
    ...(typeof item.exitCode === "number" && Number.isInteger(item.exitCode)
      ? { exitCode: item.exitCode }
      : {}),
    ...(optionalString(item.plan) ? { plan: item.plan as string } : {}),
  };
}

export function parseShowtailReport(value: unknown): ShowtailReport {
  const root = record(value, "report");
  if (typeof root.generatedAt !== "string")
    throw new Error("report.generatedAt must be a string");
  if (typeof root.displayName !== "string")
    throw new Error("report.displayName must be a string");
  if (!Array.isArray(root.turns))
    throw new Error("report.turns must be an array");
  const schemaVersion = root.schemaVersion === 2 ? 2 : 1;
  const turns = root.turns.map((rawTurn, turnIndex): ShowtailTurn => {
    const turn = record(rawTurn, `turns[${turnIndex}]`);
    const events = Array.isArray(turn.events)
      ? turn.events
          .map((event, eventIndex) =>
            v2Event(event, `turns[${turnIndex}].events[${eventIndex}]`),
          )
          .sort((left, right) => left.sequence - right.sequence)
      : undefined;
    if (schemaVersion === 2 && (!events || events.length === 0))
      throw new Error(
        `turns[${turnIndex}].events is required for schemaVersion 2`,
      );
    return {
      prompt: text(turn.prompt, `turns[${turnIndex}].prompt`),
      ...(events ? { events } : {}),
      aiOutputs: Array.isArray(turn.aiOutputs)
        ? turn.aiOutputs.map((item, index) =>
            text(item, `turns[${turnIndex}].aiOutputs[${index}]`),
          )
        : [],
      codeChanges: Array.isArray(turn.codeChanges)
        ? turn.codeChanges.map((item, index) => {
            const change = record(
              item,
              `turns[${turnIndex}].codeChanges[${index}]`,
            );
            if (typeof change.path !== "string")
              throw new Error(
                `turns[${turnIndex}].codeChanges[${index}].path must be a string`,
              );
            return {
              path: change.path,
              ...(optionalString(change.diff)
                ? { diff: change.diff as string }
                : {}),
              ...(optionalString(change.timestamp)
                ? { timestamp: change.timestamp as string }
                : {}),
            };
          })
        : [],
      toolCalls: Array.isArray(turn.toolCalls)
        ? turn.toolCalls.map((item, index) => {
            const call = record(
              item,
              `turns[${turnIndex}].toolCalls[${index}]`,
            );
            if (
              typeof call.toolName !== "string" ||
              typeof call.text !== "string"
            )
              throw new Error(
                `turns[${turnIndex}].toolCalls[${index}] is invalid`,
              );
            return {
              toolName: call.toolName,
              text: call.text,
              ...(optionalString(call.timestamp)
                ? { timestamp: call.timestamp as string }
                : {}),
              ...(call.isError === true ? { isError: true } : {}),
            };
          })
        : [],
    };
  });
  return {
    schemaVersion,
    generatedAt: root.generatedAt,
    displayName: root.displayName,
    ...(optionalString(root.sessionId)
      ? { sessionId: root.sessionId as string }
      : {}),
    turns,
  };
}
