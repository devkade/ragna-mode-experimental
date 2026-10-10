import type { Clock, Runner } from "./run.ts";

export type Pane = {
  readonly pane_id: string;
  readonly workspace_id: string;
  readonly tab_id?: string;
  readonly agent?: string;
  readonly agent_status?: string;
  readonly title?: string;
  readonly cwd?: string;
};

export class UnsafeTextError extends Error {}

export const listPanes = async (run: Runner): Promise<Pane[]> => {
  const r = await run(["herdr", "pane", "list"]);
  if (r.code !== 0) throw new Error(`herdr pane list failed: ${r.err || r.out}`);
  return (JSON.parse(r.out) as { result: { panes: Pane[] } }).result.panes;
};

export const readScreen = async (run: Runner, pane: string, lines?: number): Promise<string> =>
  (await run(["herdr", "pane", "read", pane, "--source", lines ? "recent" : "visible", ...(lines ? ["--lines", String(lines)] : [])])).out;

const promptHolds = (screen: string, probe: string): boolean =>
  screen.split("\n").some((l) => l.trimStart().startsWith("❯") && l.includes(probe));

export const sendVerified = async (run: Runner, clock: Clock, pane: string, text: string): Promise<boolean> => {
  if (/`|\$\(/.test(text)) throw new UnsafeTextError("refusing to send text containing a backtick or $(");
  if ((await run(["herdr", "pane", "send-text", pane, text])).code !== 0) return false;
  await run(["herdr", "pane", "send-keys", pane, "enter"]);
  const probe = text.slice(0, 24);
  for (let attempt = 0; attempt < 4; attempt++) {
    await clock.sleep(700);
    if (!promptHolds(await readScreen(run, pane), probe)) return true;
    if (attempt < 3) await run(["herdr", "pane", "send-keys", pane, "enter"]);
  }
  return false;
};
