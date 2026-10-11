import { expect, test } from "bun:test";
import { createAssistantMessageEventStream, type Model, type ProviderStreams } from "@earendil-works/pi-ai";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GatewayRequest } from "../src/gateway.ts";
import { createDurableTurn, inspectDurableTrace, loadGatewayModel } from "../src/messenger/pi-durable-turn.ts";

const model: Model<"openai-completions"> = {
  id: "test-model", name: "test-model", api: "openai-completions", provider: "test", baseUrl: "http://test.invalid",
  reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 512,
};

const provider = (failure?: Error): ProviderStreams => ({
  stream: () => {
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
      if (failure) {
        stream.push({ type: "error", reason: "error", error: { role: "assistant", content: [], api: "openai-completions", provider: "test", model: "test-model", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "error", timestamp: Date.now(), errorMessage: failure.message } });
      } else {
        const message = { role: "assistant" as const, content: [{ type: "text" as const, text: "durable answer" }], api: "openai-completions", provider: "test", model: "test-model", usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" as const, timestamp: Date.now() };
        stream.push({ type: "start", partial: message });
        stream.push({ type: "text_start", contentIndex: 0, partial: message });
        stream.push({ type: "text_delta", contentIndex: 0, delta: "durable answer", partial: message });
        stream.push({ type: "text_end", contentIndex: 0, content: "durable answer", partial: message });
        stream.push({ type: "done", reason: "stop", message });
      }
    });
    return stream;
  },
  streamSimple: (m, c, o) => provider(failure).stream(m, c, o),
});

const request: GatewayRequest = { platform: "discord", guildId: "1553711786325180000", channelId: "1553711786325180486", messageId: "734365821278879794", requesterId: "734365821278879794", text: "make one answer", bot: false };
const createTurn = (stateDir: string, api = provider()) => createDurableTurn({ stateDir, baseUrl: "http://test.invalid", apiKey: "test-key", model: { ...model, provider: "ragna-opencodex" }, api });
const recordData = (entry: { data: unknown } | undefined): Record<string, unknown> => {
  if (!entry?.data || typeof entry.data !== "object" || Array.isArray(entry.data)) throw new Error("Expected durable Ragna entry data");
  return Object.fromEntries(Object.entries(entry.data));
};

test("reopened Pi Durable storage links generic gateway request and accepted reply ID", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ragna-durable-accepted-"));
  try {
    const turn = await createTurn(dir);
    const response = await turn.run(request);
    await turn.recordDelivery(request, "attempt", response);
    await turn.recordDelivery(request, "accepted", response, "1522155576123985950");
    await turn.close();
    const trace = await inspectDurableTrace(`${dir}/gateway-traces`);
    const records = trace.entries.filter((entry) => entry.kind.startsWith("ragna.gateway."));
    const result = records.find((entry) => entry.kind === "ragna.gateway.turn.result");
    const attempt = records.find((entry) => entry.kind === "ragna.gateway.delivery.attempt");
    const accepted = records.find((entry) => entry.kind === "ragna.gateway.delivery.accepted");
    expect(records).toHaveLength(3);
    const resultData = recordData(result);
    const attemptData = recordData(attempt);
    const acceptedData = recordData(accepted);
    expect(resultData).toMatchObject({ platform: "discord", requestMessageId: request.messageId, requesterId: request.requesterId, guildId: request.guildId, channelId: request.channelId, submissionId: expect.any(Number), answerEntryId: expect.any(Number), response: "durable answer" });
    expect(attemptData).toMatchObject({ requestMessageId: request.messageId, submissionId: resultData.submissionId, answerEntryId: resultData.answerEntryId, resultEntryId: expect.any(Number), response: "durable answer" });
    expect(acceptedData).toMatchObject({ platform: "discord", requestMessageId: request.messageId, channelId: request.channelId, submissionId: attemptData.submissionId, answerEntryId: attemptData.answerEntryId, resultEntryId: attemptData.resultEntryId, attemptEntryId: expect.any(Number), replyId: "1522155576123985950" });
    expect(attempt?.id).toEqual(expect.any(Number));
    expect(acceptedData.attemptEntryId).toEqual(attempt?.id);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("reopened Pi Durable storage keeps failed reply attempt without acceptance", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ragna-durable-failed-send-"));
  try {
    const turn = await createTurn(dir);
    const response = await turn.run(request);
    await turn.recordDelivery(request, "attempt", response);
    await expect((async () => { throw new Error("reply command rejected"); })()).rejects.toThrow("reply command rejected");
    await turn.close();
    const trace = await inspectDurableTrace(`${dir}/gateway-traces`);
    expect(trace.entries.map((entry) => entry.kind).filter((kind) => kind.startsWith("ragna.gateway.")).sort()).toEqual(["ragna.gateway.delivery.attempt", "ragna.gateway.turn.result"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Pi provider failure persists no delivery acceptance", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ragna-durable-failed-pi-"));
  try {
    const turn = await createTurn(dir, provider(new Error("provider failed")));
    await expect(turn.run(request)).rejects.toThrow();
    await turn.close();
    const trace = await inspectDurableTrace(`${dir}/gateway-traces`);
    expect(trace.entries.some((entry) => entry.kind === "ragna.gateway.delivery.accepted")).toBe(false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("gateway model resolves selected provider and model from models.json", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ragna-model-config-"));
  const path = join(dir, "models.json");
  try {
    await Bun.write(path, JSON.stringify({ providers: { chosen: { baseUrl: "https://provider.example/v1", api: "openai-completions", apiKey: "secret-from-models-file", models: [{ ...model, id: "selected-model", provider: "chosen", baseUrl: "https://provider.example/v1" }] } } }));
    const selected = await loadGatewayModel({ provider: "chosen", model: "selected-model", modelsPath: path });
    expect(selected).toMatchObject({ provider: "chosen", baseUrl: "https://provider.example/v1", apiKey: "secret-from-models-file", model: { id: "selected-model" } });
    await expect(loadGatewayModel({ provider: "chosen", model: "missing", modelsPath: path })).rejects.toThrow("no configured model missing");
    await Bun.write(path, JSON.stringify({ providers: { chosen: { baseUrl: "https://provider.example", api: "anthropic-messages", apiKey: "secret", models: [] } } }));
    await expect(loadGatewayModel({ provider: "chosen", model: "selected-model", modelsPath: path })).rejects.toThrow("supports openai-completions only");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
