import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, createProvider, envApiKeyAuth, type Model, type ProviderStreams } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { AssistantEntry, createRegistry, Harness } from "@earendil-works/pi-durable";
import { type EntryId, defineDoc } from "@earendil-works/pi-durable";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import type { GatewayRequest } from "../gateway.ts";

export type GatewayModel = {
  readonly provider: string;
  readonly baseUrl: string;
  readonly model: Model<"openai-completions">;
  readonly api?: ProviderStreams;
  readonly apiKey: string;
  readonly authEnv: string;
};

export type DurableTurnDeps = {
  readonly stateDir: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: Model<"openai-completions">;
  readonly api?: ProviderStreams;
  readonly authEnv?: string;
};

const DeliveryLog = defineDoc({
  kind: "ragna.gateway.delivery",
  version: 1,
  scope: "session",
  initial: () => ({ records: [] as { kind: string; requestMessageId: string; submissionId?: number; answerEntryId?: number; resultEntryId?: number; attemptEntryId?: number; replyId?: string; response?: string }[] }),
});

export const createDurableTurn = async ({ stateDir, baseUrl, apiKey, model: configuredModel, api, authEnv = "RAGNA_GATEWAY_API_KEY" }: DurableTurnDeps) => {
  const previousApiKey = process.env[authEnv];
  if (previousApiKey && previousApiKey !== apiKey) throw new Error(`${authEnv} conflicts with selected Pi models.json key`);
  process.env[authEnv] = apiKey;
  const provider = createProvider({
    id: "ragna-gateway-provider",
    name: "Ragna gateway provider",
    baseUrl,
    auth: { apiKey: envApiKeyAuth("Ragna gateway provider", [authEnv]) },
    models: [{ ...configuredModel, provider: "ragna-gateway-provider" }],
    api: api ?? openAICompletionsApi(),
  });
  const models = createModels();
  models.setProvider(provider);
  const model = models.getModel("ragna-gateway-provider", configuredModel.id);
  if (!model) throw new Error("Configured gateway model is unavailable");
  const storage = await openNodeJsonlStorage(`${stateDir}/gateway-traces`, BACKGROUND_CONTEXT, { fsync: true });
  const harness = await Harness.open(storage, { models, registry: createRegistry(), settings: { stream: { timeoutMs: 30_000, maxRetries: 0 }, retry: { enabled: false, maxRetries: 0, baseDelayMs: 0 } } }, BACKGROUND_CONTEXT);
  let root: Awaited<ReturnType<typeof harness.root>>;
  try {
    root = await harness.root(BACKGROUND_CONTEXT, { agent: { model: { provider: model.provider, modelId: model.id } } });
  } catch (error) {
    await harness.close(BACKGROUND_CONTEXT);
    if (previousApiKey === undefined) delete process.env[authEnv];
    throw error;
  }
  const delivered = new Map<string, { submissionId: number; answerEntryId: number; resultEntryId: EntryId }>();
  return {
    async run(request: GatewayRequest): Promise<string> {
      const submission = await root.submit({ type: "input", content: `${request.platform} request ${request.messageId} from ${request.requesterId} in ${request.channelId}:\n\n${request.text}` }, BACKGROUND_CONTEXT);
      const settled = await submission.wait(BACKGROUND_CONTEXT);
      if (settled.status !== "done" || settled.type !== "input") throw new Error(`Pi Durable submission did not complete: ${JSON.stringify(settled)}`);
      const answer = await root.commit((tx) => tx.entry(AssistantEntry, settled.answer), BACKGROUND_CONTEXT);
      const content = answer?.model?.[0]?.content;
      const text = typeof content === "string" ? content : content?.filter((part) => part.type === "text").map((part) => part.text).join("");
      if (!text?.trim()) throw new Error("Pi Durable completed without assistant text");
      const resultEntry = await root.commit(async (tx) => {
        const log = await tx.doc(DeliveryLog);
        const entry = await tx.appendEntry(root.id, { kind: "ragna.gateway.turn.result", data: { platform: request.platform, requestMessageId: request.messageId, requesterId: request.requesterId, channelId: request.channelId, ...(request.guildId === undefined ? {} : { guildId: request.guildId }), ...(request.threadId === undefined ? {} : { threadId: request.threadId }), submissionId: Number(submission.id), answerEntryId: Number(settled.answer), response: text } });
        log.records.push({ kind: "turn.result", requestMessageId: request.messageId, submissionId: Number(submission.id), answerEntryId: Number(settled.answer), resultEntryId: Number(entry.id), response: text });
        return entry.id;
      }, BACKGROUND_CONTEXT);
      delivered.set(request.messageId, { submissionId: Number(submission.id), answerEntryId: Number(settled.answer), resultEntryId: resultEntry });
      return text;
    },
    async recordDelivery(request: GatewayRequest, phase: "attempt" | "accepted", response: string, messageId?: string): Promise<void> {
      const linked = delivered.get(request.messageId);
      if (!linked) throw new Error("No successful Pi turn is available for gateway delivery evidence");
      await root.commit(async (tx) => {
        const log = await tx.doc(DeliveryLog);
        if (phase === "attempt") {
          const entry = await tx.appendEntry(root.id, { kind: "ragna.gateway.delivery.attempt", data: { platform: request.platform, requestMessageId: request.messageId, channelId: request.channelId, submissionId: linked.submissionId, answerEntryId: linked.answerEntryId, resultEntryId: linked.resultEntryId, response } });
          log.records.push({ kind: "delivery.attempt", requestMessageId: request.messageId, submissionId: linked.submissionId, answerEntryId: linked.answerEntryId, resultEntryId: linked.resultEntryId, attemptEntryId: Number(entry.id), response });
        } else {
          if (!messageId) throw new Error("Gateway acceptance requires a reply ID");
          const priorAttempt = log.records.findLast((record) => record.kind === "delivery.attempt" && record.requestMessageId === request.messageId);
          if (!priorAttempt?.attemptEntryId) throw new Error("Gateway acceptance has no durable send attempt");
          const attemptEntryId = Number(priorAttempt.attemptEntryId);
          const entry = await tx.appendEntry(root.id, { kind: "ragna.gateway.delivery.accepted", data: { platform: request.platform, requestMessageId: request.messageId, channelId: request.channelId, submissionId: linked.submissionId, answerEntryId: linked.answerEntryId, resultEntryId: linked.resultEntryId, attemptEntryId, replyId: messageId } });
          log.records.push({ kind: "delivery.accepted", requestMessageId: request.messageId, submissionId: linked.submissionId, answerEntryId: linked.answerEntryId, resultEntryId: linked.resultEntryId, attemptEntryId, replyId: messageId });
        }
      }, BACKGROUND_CONTEXT);
    },
    async abort(): Promise<void> {
      await root.abort(BACKGROUND_CONTEXT);
    },
    async waitForTurn(): Promise<void> {
      await root.waitForIdle(BACKGROUND_CONTEXT);
    },
    close: async () => {
      try { await harness.close(BACKGROUND_CONTEXT); }
      finally {
        if (previousApiKey === undefined) delete process.env[authEnv];
        else process.env[authEnv] = previousApiKey;
      }
    },
  };
};

export const inspectDurableTrace = async (traceDir: string) => {
  const storage = await openNodeJsonlStorage(traceDir, BACKGROUND_CONTEXT, { fsync: true });
  try {
    const page = await storage.scanConversations({}, 100, undefined, BACKGROUND_CONTEXT);
    const conversations = page.items.length;
    if (!page.items[0]) return { conversations, entries: [] as { id: number; kind: string; data: unknown }[] };
    const entries = await storage.scanEntries({ conversationId: page.items[0].id }, 1000, undefined, BACKGROUND_CONTEXT);
    return { conversations, entries: entries.items.map(({ id, kind, data }) => ({ id: Number(id), kind, data })) };
  } finally {
    await storage.close(BACKGROUND_CONTEXT);
  }
};

export const loadGatewayModel = async (
  selection: { readonly provider: string; readonly model: string; readonly modelsPath?: string },
  path = selection.modelsPath ?? join(homedir(), ".pi/agent/models.json"),
): Promise<GatewayModel> => {
  const raw = JSON.parse(await readFile(path, "utf8")) as {
    providers?: Record<string, { baseUrl?: unknown; api?: unknown; apiKey?: unknown; models?: unknown }>;
  };
  const provider = raw.providers?.[selection.provider];
  if (!provider || typeof provider.baseUrl !== "string" || !provider.baseUrl || typeof provider.apiKey !== "string" || !provider.apiKey) throw new Error(`Pi models.json has no configured ${selection.provider} endpoint and key`);
  if (provider.api !== "openai-completions") throw new Error(`Pi models.json provider ${selection.provider} uses unsupported API ${String(provider.api)}; gateway supports openai-completions only`);
  if (!Array.isArray(provider.models)) throw new Error(`Pi models.json has no ${selection.provider} model catalog`);
  const definition = provider.models.find((candidate): candidate is Omit<Model<"openai-completions">, "api" | "provider" | "baseUrl" | "cost"> & { cost?: Model<"openai-completions">["cost"] } =>
    typeof candidate === "object" && candidate !== null && "id" in candidate && candidate.id === selection.model,
  );
  if (!definition) throw new Error(`Pi models.json provider ${selection.provider} has no configured model ${selection.model}`);
  const model: Model<"openai-completions"> = {
    ...definition,
    api: "openai-completions",
    provider: "ragna-gateway-provider",
    baseUrl: provider.baseUrl,
    cost: definition.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  return { provider: selection.provider, baseUrl: provider.baseUrl, apiKey: provider.apiKey, model, authEnv: `RAGNA_GATEWAY_${selection.provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY` };
};

export const createPiDurableTurn = async (stateDir: string, selection: { readonly provider: string; readonly model: string; readonly modelsPath?: string }) => {
  const configured = await loadGatewayModel(selection);
  return createDurableTurn({ stateDir, baseUrl: configured.baseUrl, apiKey: configured.apiKey, model: configured.model, authEnv: configured.authEnv });
};

export const createPiDurableLifecycle = async (
  stateDir: string,
  selection: { readonly provider: string; readonly model: string; readonly modelsPath?: string },
  create: typeof createPiDurableTurn = createPiDurableTurn,
) => create(stateDir, selection);

if (import.meta.main) {
  const { values } = parseArgs({ options: { trace: { type: "string" }, provider: { type: "string" }, model: { type: "string" }, models: { type: "string" } }, strict: true });
  if (!values.trace || !values.provider || !values.model) throw new Error("--trace DIR, --provider NAME, and --model NAME are required");
  const turn = await createPiDurableTurn(values.trace, { provider: values.provider, model: values.model, ...(values.models ? { modelsPath: values.models } : {}) });
  try {
    const answer = await turn.run({ platform: "local", channelId: "local", messageId: "local-model-smoke", requesterId: "local", text: "Reply with exactly: RAGNA gateway test OK", bot: false });
    if (answer.trim() !== "RAGNA gateway test OK") throw new Error(`Model smoke response mismatch: ${JSON.stringify(answer.slice(0, 512))}`);
    console.log("MODEL_SMOKE_OK RAGNA gateway test OK");
  } finally {
    await turn.close();
  }
}
