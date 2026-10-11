import { readFile } from "node:fs/promises";
import { fill, type GatewayConfig } from "./config.ts";
import type { Runner } from "./run.ts";

export type GatewayRequest = {
  readonly platform: string;
  readonly channelId: string;
  readonly messageId: string;
  readonly requesterId: string;
  readonly text: string;
  readonly bot: boolean;
  readonly guildId?: string;
  readonly threadId?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export const parseGatewayRequest = (value: unknown): GatewayRequest | undefined => {
  if (!isRecord(value)) return undefined;
  const { platform, channelId, messageId, requesterId, text, bot, guildId, threadId } = value;
  if (typeof platform !== "string" || !platform || typeof channelId !== "string" || !channelId ||
      typeof messageId !== "string" || !messageId || typeof requesterId !== "string" || !requesterId ||
      typeof text !== "string" || typeof bot !== "boolean" ||
      (guildId !== undefined && typeof guildId !== "string") || (threadId !== undefined && typeof threadId !== "string")) return undefined;
  const trimmed = text.trim();
  if (bot || !trimmed) return undefined;
  return { platform, channelId, messageId, requesterId, text: trimmed, bot,
    ...(guildId === undefined ? {} : { guildId }), ...(threadId === undefined ? {} : { threadId }) };
};

export const authorizeGatewayRequest = (request: GatewayRequest, config: GatewayConfig) => {
  const platform = config[request.platform];
  return platform && request.requesterId === platform.allowedUserId && request.channelId === platform.allowedChannelId ? platform : undefined;
};

export const validateGatewayReplyTemplate = (request: GatewayRequest, template: readonly string[]): void => {
  const missing = template.flatMap((part) => [...part.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))
    .find((name) => name === "guildId" ? request.guildId === undefined : name === "threadId" && request.threadId === undefined);
  if (missing) throw new Error(`Gateway reply template requires missing request field {${missing}}`);
};

export const replyId = (body: string, path = "id"): string | undefined => {
  let value: unknown;
  try { value = JSON.parse(body); } catch { return undefined; }
  if (!isRecord(value) || "error" in value) return undefined;
  let current: unknown = value;
  for (const part of path.split(".")) {
    if (!isRecord(current) || !(part in current)) return undefined;
    current = current[part];
  }
  if (typeof current === "string" && current.trim()) return current;
  if (typeof current === "number" && Number.isSafeInteger(current)) return String(current);
  return undefined;
};

export const deliverGatewayReply = async (
  request: GatewayRequest,
  response: string,
  config: { readonly reply: readonly string[]; readonly replyIdPath?: string },
  run: Runner,
): Promise<string> => {
  const values: Record<string, string> = { ...request, text: response, bot: String(request.bot) };
  const result = await run(fill(config.reply, values));
  if (result.code !== 0) throw new Error(`Gateway reply command failed (${result.code}): ${result.err}`);
  const id = replyId(result.out, config.replyIdPath);
  if (!id) throw new Error(`Gateway reply command output has no ID at ${config.replyIdPath ?? "id"}`);
  return id;
};

export const readGatewayRequest = async (file: string): Promise<unknown> => {
  const source = file === "-" ? await new Response(Bun.stdin.stream()).text() : await readFile(file, "utf8");
  return JSON.parse(source) as unknown;
};
