import type { RagnaConfig } from "./config.ts";
import { listPanes, readScreen } from "./panes.ts";
import type { Runner } from "./run.ts";

export const deadPaneTick = async (run: Runner, config: RagnaConfig, seen: Set<string>, hourKey: string): Promise<string[]> => {
  const out: string[] = [];
  const watch = new Set(config.workspaces);
  const skip = new Set([config.leadPane, ...config.ignorePanes].filter(Boolean));
  for (const pane of await listPanes(run)) {
    if (skip.has(pane.pane_id) || (watch.size > 0 && !watch.has(pane.workspace_id))) continue;
    const tail = (await readScreen(run, pane.pane_id, 6)).toLowerCase();
    if (!config.deadPanePatterns.some((p) => tail.includes(p.toLowerCase()))) continue;
    const mark = `${pane.pane_id} ${hourKey}`;
    if (seen.has(mark)) continue;
    seen.add(mark);
    out.push(`DEAD_PANE ${pane.pane_id}`);
  }
  return out;
};
