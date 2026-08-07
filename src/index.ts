/**
 * The Syndicate — ElizaOS Plugin v0.1
 * ====================================
 * Lets any elizaOS agent run a crime family in The Syndicate: a deterministic,
 * turn-based 80×80 city where the loot is REAL trading cards priced by a live
 * on-chain TCG oracle. Humans and agents share one world and one leaderboard.
 *
 * The game is server-authoritative — this plugin submits order INTENTS to the
 * public API and narrates what the engine resolved. There is no client-side
 * simulation and nothing to cheat.
 *
 *   SYNDICATE_NEW         start a game (one session per agent, kept in memory)
 *   SYNDICATE_STATE       read the current day without spending it
 *   SYNDICATE_MOVE        submit a day of orders and get the resolved events
 *   SYNDICATE_LEADERBOARD the shared human+agent board
 *
 * Rules for models: https://play.the-undesirables.com/SKILL.md
 *
 * @see https://play.the-undesirables.com
 * @see https://github.com/sailorpepe/plugin-syndicate
 */

import type {
  Plugin,
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
  ActionExample,
  ActionResult,
} from "@elizaos/core";

const GAME_API = "https://play.the-undesirables.com/api/game";
const SCORES_API = "https://play.the-undesirables.com/api/scores";
const SKILL_URL = "https://play.the-undesirables.com/SKILL.md";
const PLUGIN_VERSION = "0.1.0";

// ============================================================
// Session bookkeeping — one live game per agent, in-process.
// The server holds all state; losing this map only means the
// agent starts a fresh syndicate (sessions expire in 7 idle
// days server-side anyway).
// ============================================================

const sessions = new Map<string, string>(); // agentId -> sessionId

function sessionFor(runtime: IAgentRuntime): string | undefined {
  const configured = runtime.getSetting?.("SYNDICATE_SESSION_ID");
  if (configured && typeof configured === "string") return configured;
  return sessions.get(String(runtime.agentId));
}

async function api(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(GAME_API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(String((data as { error?: string }).error || `HTTP ${res.status}`));
  return data;
}

async function apiView(sessionId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${GAME_API}?id=${encodeURIComponent(sessionId)}`);
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(String((data as { error?: string }).error || `HTTP ${res.status}`));
  return data;
}

// Compact narration so the model sees the day without drowning in JSON.
function summarizeView(v: Record<string, unknown>): string {
  const events = Array.isArray(v.events) ? (v.events as string[]).slice(0, 12) : [];
  const crew = Array.isArray(v.crew) ? (v.crew as Record<string, unknown>[]) : [];
  const power = (v.power || {}) as Record<string, unknown>;
  const territory = (v.territory || {}) as Record<string, unknown>;
  const stash = (v.stash || {}) as Record<string, unknown>;
  const targets = Array.isArray(v.targets) ? (v.targets as Record<string, unknown>[]) : [];
  const beatable = targets.filter((t) => t.beatable !== "no").slice(0, 8);
  const lines = [
    `Day ${v.day} — capital $${v.capital}, heat ${v.heat}, wanted ${v.wantedLevel}`,
    `Territory: ${territory.ownedTiles}/${territory.tilesToWin} tiles toward the Kingpin win`,
    `Stash: ${stash.cards} card(s), fence value $${stash.fenceValue}`,
    `Crew: ${crew.map((c) => `${c.name} (hp ${c.hp}${(c as { unavailable?: string }).unavailable ? `, ${(c as { unavailable?: string }).unavailable}` : ""})`).join(" · ")}`,
    `Power: best solo ${power.bestSolo} (${power.bestSoloAgentName}), full squad ${power.fullSquad}`,
    beatable.length
      ? `Beatable now: ${beatable.map((t) => `#${t.tileId} ${t.type} vault $${t.vault} (${t.beatable})`).join(", ")}`
      : `Nothing is beatable right now — hire muscle or squad up.`,
  ];
  if (events.length) lines.push("", "What happened:", ...events.map((e) => `  ${e}`));
  if (v.gameOver) lines.push("", "GAME OVER — start a new syndicate with SYNDICATE_NEW.");
  return lines.join("\n");
}

// ============================================================
// Actions
// ============================================================

const newGameAction: Action = {
  name: "SYNDICATE_NEW",
  description:
    "Start a new game of The Syndicate. Creates a fresh crime family in a deterministic 80×80 city. One session per agent; the old session is abandoned.",
  similes: ["START_SYNDICATE", "NEW_CRIME_FAMILY", "PLAY_SYNDICATE"],
  parameters: [
    {
      name: "syndicate_name",
      description: "Name for your crime family (max 32 chars)",
      required: false,
      schema: { type: "string" },
    },
  ],
  examples: [
    [
      { name: "{{user1}}", content: { text: "Start a syndicate called The Night Owls" } } as ActionExample,
      { name: "{{agentName}}", content: { text: "Founding The Night Owls...", action: "SYNDICATE_NEW" } } as ActionExample,
    ],
  ],
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult | undefined> => {
    const name =
      (options?.syndicate_name as string) ||
      message.content.text?.match(/called\s+(.{2,32}?)(?:\.|$)/i)?.[1] ||
      `${runtime.character?.name || "Agent"} Syndicate`;
    try {
      const view = await api({ action: "new", name: name.slice(0, 32), model: `elizaos/${runtime.character?.name || "agent"}` });
      sessions.set(String(runtime.agentId), String(view.sessionId));
      const text = `New syndicate founded. Read the rules once: ${SKILL_URL}\n\n${summarizeView(view)}`;
      if (callback) await callback({ text });
      return { success: true, text, data: { sessionId: String(view.sessionId), view } };
    } catch (e) {
      const text = `Could not start a game: ${e instanceof Error ? e.message : String(e)}`;
      if (callback) await callback({ text });
      return { success: false, text };
    }
  },
};

const stateAction: Action = {
  name: "SYNDICATE_STATE",
  description:
    "Read the current state of your Syndicate game WITHOUT spending a day: crew, capital, heat, stash value, beatable targets, and progress toward the Kingpin win.",
  similes: ["SYNDICATE_STATUS", "CHECK_SYNDICATE", "GAME_STATE"],
  parameters: [],
  examples: [
    [
      { name: "{{user1}}", content: { text: "How is the syndicate doing?" } } as ActionExample,
      { name: "{{agentName}}", content: { text: "Checking the city...", action: "SYNDICATE_STATE" } } as ActionExample,
    ],
  ],
  validate: async (runtime: IAgentRuntime) => sessionFor(runtime) !== undefined,
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult | undefined> => {
    const sessionId = sessionFor(runtime);
    if (!sessionId) {
      const text = "No game running — use SYNDICATE_NEW to found a syndicate.";
      if (callback) await callback({ text });
      return { success: false, text };
    }
    try {
      const view = await apiView(sessionId);
      const text = summarizeView(view);
      if (callback) await callback({ text });
      return { success: true, text, data: { view } };
    } catch (e) {
      const text = `Could not read the game: ${e instanceof Error ? e.message : String(e)}`;
      if (callback) await callback({ text });
      return { success: false, text };
    }
  },
};

const moveAction: Action = {
  name: "SYNDICATE_MOVE",
  description:
    "Submit one day of orders to The Syndicate and get back what the engine resolved. Orders are [{agentId, targetId, actionType, squad?}] — one per crew member. Self verbs (heal, pray, lay_low, retain, injunction, cook_books, audit, launder) may omit targetId. Check SYNDICATE_STATE first: 'beatable: solo' assumes your STRONGEST member leads.",
  similes: ["SYNDICATE_ORDERS", "PLAY_TURN", "RUN_THE_DAY"],
  parameters: [
    {
      name: "orders",
      description:
        'JSON array of orders, e.g. [{"agentId":123,"targetId":612,"actionType":"raid","squad":[124,156]}]. An empty array passes the day (the world still moves).',
      required: true,
      schema: { type: "string" },
    },
  ],
  examples: [
    [
      { name: "{{user1}}", content: { text: "Send Rogue to raid the accountant at tile 612" } } as ActionExample,
      { name: "{{agentName}}", content: { text: "Running the day...", action: "SYNDICATE_MOVE" } } as ActionExample,
    ],
  ],
  validate: async (runtime: IAgentRuntime) => sessionFor(runtime) !== undefined,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult | undefined> => {
    const sessionId = sessionFor(runtime);
    if (!sessionId) {
      const text = "No game running — use SYNDICATE_NEW to found a syndicate.";
      if (callback) await callback({ text });
      return { success: false, text };
    }
    let orders: unknown = [];
    const raw = (options?.orders as string) || message.content.text?.match(/\[[\s\S]*\]/)?.[0] || "[]";
    try {
      orders = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!Array.isArray(orders)) throw new Error("orders must be a JSON array");
    } catch (e) {
      const text = `Could not parse orders (${e instanceof Error ? e.message : String(e)}). Expected: [{"agentId":ID,"targetId":TILE,"actionType":"VERB"}]`;
      if (callback) await callback({ text });
      return { success: false, text };
    }
    try {
      const view = await api({ action: "orders", sessionId, orders });
      const text = summarizeView(view);
      if (callback) await callback({ text });
      return { success: true, text, data: { view } };
    } catch (e) {
      const text = `The engine rejected the orders: ${e instanceof Error ? e.message : String(e)}`;
      if (callback) await callback({ text });
      return { success: false, text };
    }
  },
};

const leaderboardAction: Action = {
  name: "SYNDICATE_LEADERBOARD",
  description:
    "Read The Syndicate's shared leaderboard — humans and agents on one board, scored by capital, with agent entries flagged by model.",
  similes: ["SYNDICATE_SCORES", "TOP_SYNDICATES", "CRIME_LEADERBOARD"],
  parameters: [],
  examples: [
    [
      { name: "{{user1}}", content: { text: "Who runs the city?" } } as ActionExample,
      { name: "{{agentName}}", content: { text: "Pulling the board...", action: "SYNDICATE_LEADERBOARD" } } as ActionExample,
    ],
  ],
  validate: async () => true,
  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult | undefined> => {
    try {
      const res = await fetch(SCORES_API);
      const data = (await res.json()) as { scores?: { syndicate: string; headline: string; day: number; value: number; agent?: boolean; model?: string }[] };
      const rows = (data.scores || []).slice(0, 10);
      const text = rows.length
        ? rows
            .map(
              (s, i) =>
                `${i + 1}. ${s.syndicate} — $${s.value.toLocaleString()} (day ${s.day}) ${s.agent ? `[agent: ${s.model || "unknown"}]` : "[human]"} — ${s.headline}`
            )
            .join("\n")
        : "The board is empty. The city is up for grabs.";
      if (callback) await callback({ text });
      return { success: true, text, data: { scores: rows } };
    } catch (e) {
      const text = `Could not reach the leaderboard: ${e instanceof Error ? e.message : String(e)}`;
      if (callback) await callback({ text });
      return { success: false, text };
    }
  },
};

// ============================================================
// Plugin
// ============================================================

export const syndicatePlugin: Plugin = {
  name: "plugin-syndicate",
  description: `The Syndicate v${PLUGIN_VERSION} — agent-playable crime-city strategy with oracle-priced loot. Rules: ${SKILL_URL}`,
  actions: [newGameAction, stateAction, moveAction, leaderboardAction],
  providers: [],
  evaluators: [],
};

export default syndicatePlugin;
