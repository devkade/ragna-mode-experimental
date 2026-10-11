import { expect, test } from "bun:test";
import { authorizeGatewayRequest, deliverGatewayReply, parseGatewayRequest, readGatewayRequest, replyId, validateGatewayReplyTemplate, type GatewayRequest } from "../src/gateway.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const request: GatewayRequest = { platform: "chat", channelId: "channel", messageId: "message", requesterId: "user", text: "hello", bot: false, threadId: "thread" };
const gateway = { chat: { allowedUserId: "user", allowedChannelId: "channel", reply: ["messenger", "reply", "{channelId}", "{threadId}", "{text}"] } };

test("gateway request parser rejects malformed, bot, empty, and missing required fields", () => {
  expect(parseGatewayRequest(request)).toEqual(request);
  expect(parseGatewayRequest({ ...request, text: "  " })).toBeUndefined();
  expect(parseGatewayRequest({ ...request, bot: true })).toBeUndefined();
  expect(parseGatewayRequest({ ...request, requesterId: "" })).toBeUndefined();
  expect(parseGatewayRequest({ ...request, bot: "false" })).toBeUndefined();
  expect(parseGatewayRequest(null)).toBeUndefined();
});

test("gateway authorization exactly matches the configured user and channel", () => {
  expect(authorizeGatewayRequest(request, gateway)).toEqual(gateway.chat);
  expect(authorizeGatewayRequest({ ...request, requesterId: "other" }, gateway)).toBeUndefined();
  expect(authorizeGatewayRequest({ ...request, channelId: "other" }, gateway)).toBeUndefined();
  expect(authorizeGatewayRequest({ ...request, platform: "other" }, gateway)).toBeUndefined();
});

test("optional identifiers referenced by reply argv fail before delivery", () => {
  expect(() => validateGatewayReplyTemplate({ ...request, threadId: undefined }, gateway.chat.reply)).toThrow("missing request field {threadId}");
  expect(() => validateGatewayReplyTemplate(request, ["send", "{guildId}"])).toThrow("requires missing request field {guildId}");
});

test("reply output extracts dotted string and safe integer IDs while rejecting errors", () => {
  expect(replyId('{"id":"abc"}')).toBe("abc");
  expect(replyId('{"message":{"message_id":42}}', "message.message_id")).toBe("42");
  expect(replyId('{"message":{"message_id":9007199254740992}}', "message.message_id")).toBeUndefined();
  expect(replyId('{"error":"denied","id":"abc"}')).toBeUndefined();
  expect(replyId("not json")).toBeUndefined();
  expect(replyId('{"id":"  "}')).toBeUndefined();
});

test("reply command receives filled argv and acceptance requires successful JSON ID", async () => {
  const calls: string[][] = [];
  const result = await deliverGatewayReply(request, "answer text", { ...gateway.chat, replyIdPath: "ts" }, async (argv) => {
    calls.push([...argv]);
    return { code: 0, out: '{"ts":"123.456"}', err: "" };
  });
  expect(result).toBe("123.456");
  expect(calls).toEqual([["messenger", "reply", "channel", "thread", "answer text"]]);
  await expect(deliverGatewayReply(request, "answer", { reply: ["send"] }, async () => ({ code: 1, out: '{"id":"x"}', err: "failed" }))).rejects.toThrow("failed (1)");
  await expect(deliverGatewayReply(request, "answer", { reply: ["send"], replyIdPath: "message.message_id" }, async () => ({ code: 0, out: '{"id":"x"}', err: "" }))).rejects.toThrow("has no ID");
});

test("request file reads the supplied JSON envelope", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ragna-gateway-request-"));
  const path = join(dir, "request.json");
  try {
    await Bun.write(path, JSON.stringify(request));
    expect(await readGatewayRequest(path)).toEqual(request);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
