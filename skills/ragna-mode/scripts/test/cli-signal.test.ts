import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const scriptDir = resolve(import.meta.dir, "../src");
const cli = join(scriptDir, "cli.ts");
const preload = join(import.meta.dir, "cli-signal-preload.ts");
const scratch: string[] = [];
const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs); })]);
  } finally { if (timer) clearTimeout(timer); }
};

afterAll(async () => { await Promise.all(scratch.map((path) => rm(path, { recursive: true, force: true }))); });

test("generic request CLI invokes configured reply executable and returns correlated JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ragna-gateway-cli-"));
  scratch.push(dir);
  const configPath = join(dir, "config.json");
  const requestPath = join(dir, "request.json");
  await writeFile(configPath, JSON.stringify({
    stateDir: join(dir, "state"), gatewayModel: { provider: "chosen", model: "model" },
    gateway: { custom: { allowedUserId: "user", allowedChannelId: "channel", replyIdPath: "message.message_id",
      reply: [process.execPath, "-e", 'console.log(JSON.stringify({message:{message_id:42},text:process.argv[1]}))', "{text}"] } },
  }));
  await writeFile(requestPath, JSON.stringify({ platform: "custom", channelId: "channel", messageId: "request", requesterId: "user", text: "hello", bot: false }));
  const child = Bun.spawn([process.execPath, "--preload", preload, cli, "request", "--file", requestPath], {
    env: { ...process.env, RAGNA_CONFIG: configPath, RAGNA_TEST_SUCCESS: "1" }, stdout: "pipe", stderr: "pipe",
  });
  const [output, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), withTimeout(child.exited, 5_000, "request CLI completion")]);
  expect(code).toBe(0);
  expect(errors).toBe("");
  expect(JSON.parse(output)).toEqual({ platform: "custom", channelId: "channel", messageId: "request", response: "gateway answer", id: "42" });
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(`generic request CLI closes durable turn on ${signal}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "ragna-gateway-signal-"));
    scratch.push(dir);
    const configPath = join(dir, "config.json");
    const requestPath = join(dir, "request.json");
    await writeFile(configPath, JSON.stringify({ stateDir: join(dir, "state"), gatewayModel: { provider: "chosen", model: "model" }, gateway: { chat: { allowedUserId: "user", allowedChannelId: "channel", reply: ["messenger", "send", "{text}"] } } }));
    await writeFile(requestPath, JSON.stringify({ platform: "chat", channelId: "channel", messageId: "message", requesterId: "user", text: "request", bot: false }));
    const child = Bun.spawn([process.execPath, "--preload", preload, cli, "request", "--file", requestPath], {
      cwd: scriptDir, env: { ...process.env, RAGNA_CONFIG: configPath }, stdout: "pipe", stderr: "pipe",
    });
    const stdout = child.stdout.getReader();
    const stderr = child.stderr.getReader();
    let output = "";
    let errorOutput = "";
    let resolveStartup!: () => void;
    const startupEvent = new Promise<void>((resolveEvent) => { resolveStartup = resolveEvent; });
    const pump = (async () => {
      while (true) {
        const { value, done } = await stdout.read();
        if (done) return;
        output += new TextDecoder().decode(value);
        if (output.includes("MOCK_TURN_PENDING")) resolveStartup();
      }
    })();
    const errorPump = (async () => {
      while (true) {
        const { value, done } = await stderr.read();
        if (done) return;
        errorOutput += new TextDecoder().decode(value);
        resolveStartup();
      }
    })();
    try {
      await withTimeout(startupEvent, 5_000, "waiting for durable turn");
      if (!output.includes("MOCK_TURN_PENDING")) throw new Error(`CLI failed before durable turn: ${output} ${errorOutput}`);
      child.kill(signal);
      expect(await withTimeout(child.exited, 5_000, `waiting for ${signal} exit`)).toBe(130);
      await pump;
      await errorPump;
      expect(errorOutput).not.toContain("Error");
      expect(output.match(/MOCK_ABORT\n/g) ?? []).toHaveLength(1);
      expect(output.match(/MOCK_WAIT_FOR_TURN\n/g) ?? []).toHaveLength(1);
      expect(output.match(/MOCK_CLOSE\n/g) ?? []).toHaveLength(1);
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
      await withTimeout(child.exited, 5_000, "reaping child");
      await stdout.cancel();
      await stderr.cancel();
    }
  });
}
