import { mock } from "bun:test";

const marker = (name: string) => console.log(`MOCK_${name}`);
if (!process.env.RAGNA_TEST_SUCCESS) mock.module("../src/run.ts", () => ({
  iso: () => "2026-10-11T00:00:00.000Z",
  run: async () => ({ code: 0, out: '{"id":"reply-id"}', err: "" }),
  realClock: { now: () => 0, sleep: async () => {} },
}));
mock.module("../src/messenger/pi-durable-turn.ts", () => ({
  createPiDurableTurn: async () => ({
    run: async () => {
      if (process.env.RAGNA_TEST_SUCCESS) return "gateway answer";
      marker("TURN_PENDING");
      return await new Promise<string>(() => {});
    },
    recordDelivery: async () => {},
    abort: async () => { marker("ABORT"); },
    waitForTurn: async () => { marker("WAIT_FOR_TURN"); },
    close: async () => { if (!process.env.RAGNA_TEST_SUCCESS) marker("CLOSE"); },
  }),
}));
