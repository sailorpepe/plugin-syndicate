import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import plugin from "./index.js";

// ── helpers ─────────────────────────────────────────────────

const act = (name: string) => {
  const a = plugin.actions.find((x) => x.name === name);
  if (!a) throw new Error(`action ${name} missing`);
  return a;
};

const rt = (agentId = "agent-1", settings: Record<string, string> = {}) =>
  ({
    agentId,
    character: { name: "TestBot" },
    getSetting: (k: string) => settings[k],
  }) as any;

const msg = (text = "") => ({ content: { text } }) as any;

const VIEW = {
  sessionId: "abc123",
  day: 3,
  capital: 7500,
  heat: 20,
  wantedLevel: 0,
  gameOver: false,
  crew: [
    { id: 1, name: "Rogue", hp: 90 },
    { id: 2, name: "Chad", hp: 40, unavailable: "hospital" },
  ],
  power: { bestSolo: 150, fullSquad: 200, bestSoloAgentId: 1, bestSoloAgentName: "Rogue" },
  territory: { ownedTiles: 4, tilesToWin: 912 },
  stash: { cards: 2, fenceValue: 1200 },
  targets: [
    { tileId: 10, type: "casino", vault: 2000, beatable: "solo" },
    { tileId: 11, type: "bank", vault: 9000, beatable: "no" },
  ],
  events: ["[SUCCESS] Rogue captured casino!"],
};

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as any;
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

// ── shape ───────────────────────────────────────────────────

describe("plugin shape", () => {
  it("registers 4 actions and the cached-state provider", () => {
    expect(plugin.actions.map((a) => a.name).sort()).toEqual([
      "SYNDICATE_LEADERBOARD",
      "SYNDICATE_MOVE",
      "SYNDICATE_NEW",
      "SYNDICATE_STATE",
    ]);
    expect(plugin.providers.map((p) => p.name)).toEqual(["syndicate-game-state"]);
  });
});

// ── SYNDICATE_NEW ───────────────────────────────────────────

describe("SYNDICATE_NEW", () => {
  it("starts a game, stores the session, narrates the day", async () => {
    vi.stubGlobal("fetch", mockFetch(200, VIEW));
    const r = (await act("SYNDICATE_NEW").handler(rt("new-1"), msg("Start a syndicate called The Owls"), undefined, undefined, async () => {})) as any;
    expect(r.success).toBe(true);
    expect(r.data.sessionId).toBe("abc123");
    expect(r.text).toContain("Day 3");
    expect(r.text).toContain("session abc123");
    // session now known → STATE validates
    expect(await act("SYNDICATE_STATE").validate!(rt("new-1"), msg(), undefined)).toBe(true);
  });

  it("extracts the syndicate name from the message", async () => {
    const f = mockFetch(200, VIEW);
    vi.stubGlobal("fetch", f);
    await act("SYNDICATE_NEW").handler(rt("new-2"), msg("start one called The Night Owls"), undefined, undefined, async () => {});
    const sent = JSON.parse(f.mock.calls[0][1].body);
    expect(sent.name).toBe("The Night Owls");
  });
});

// ── SYNDICATE_STATE ─────────────────────────────────────────

describe("SYNDICATE_STATE", () => {
  it("refuses without a session", async () => {
    expect(await act("SYNDICATE_STATE").validate!(rt("cold"), msg(), undefined)).toBe(false);
    const r = (await act("SYNDICATE_STATE").handler(rt("cold"), msg(), undefined, undefined, async () => {})) as any;
    expect(r.success).toBe(false);
    expect(r.text).toContain("SYNDICATE_NEW");
  });

  it("honors SYNDICATE_SESSION_ID from settings and narrates beatable targets", async () => {
    vi.stubGlobal("fetch", mockFetch(200, VIEW));
    const r = (await act("SYNDICATE_STATE").handler(rt("cfg", { SYNDICATE_SESSION_ID: "abc123" }), msg(), undefined, undefined, async () => {})) as any;
    expect(r.success).toBe(true);
    expect(r.text).toContain("#10 casino vault $2000 (solo)");
    expect(r.text).not.toContain("#11 bank"); // unbeatable targets stay out of the summary
    expect(r.text).toContain("Chad (hp 40, hospital)");
  });

  it("clears an expired session and steers to SYNDICATE_NEW", async () => {
    vi.stubGlobal("fetch", mockFetch(200, VIEW));
    await act("SYNDICATE_NEW").handler(rt("exp"), msg(), undefined, undefined, async () => {});
    vi.stubGlobal("fetch", mockFetch(404, { error: "unknown or expired session" }));
    const r = (await act("SYNDICATE_STATE").handler(rt("exp"), msg(), undefined, undefined, async () => {})) as any;
    expect(r.success).toBe(false);
    expect(r.text).toContain("expired");
    expect(await act("SYNDICATE_STATE").validate!(rt("exp"), msg(), undefined)).toBe(false); // forgotten
  });
});

// ── SYNDICATE_MOVE ──────────────────────────────────────────

describe("SYNDICATE_MOVE", () => {
  const withSession = rt("mv", { SYNDICATE_SESSION_ID: "abc123" });

  it("parses orders from options and submits them", async () => {
    const f = mockFetch(200, VIEW);
    vi.stubGlobal("fetch", f);
    const orders = [{ agentId: 1, targetId: 10, actionType: "raid", squad: [2] }];
    const r = (await act("SYNDICATE_MOVE").handler(withSession, msg(), undefined, { orders: JSON.stringify(orders) }, async () => {})) as any;
    expect(r.success).toBe(true);
    expect(JSON.parse(f.mock.calls[0][1].body).orders).toEqual(orders);
  });

  it("falls back to a JSON array inside the message text", async () => {
    const f = mockFetch(200, VIEW);
    vi.stubGlobal("fetch", f);
    await act("SYNDICATE_MOVE").handler(withSession, msg('run [{"agentId":1,"targetId":10,"actionType":"raid"}] now'), undefined, undefined, async () => {});
    expect(JSON.parse(f.mock.calls[0][1].body).orders).toHaveLength(1);
  });

  it("rejects unparseable orders without calling the API", async () => {
    const f = mockFetch(200, VIEW);
    vi.stubGlobal("fetch", f);
    const r = (await act("SYNDICATE_MOVE").handler(withSession, msg(), undefined, { orders: "{not json" }, async () => {})) as any;
    expect(r.success).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("relays engine rejections readably", async () => {
    vi.stubGlobal("fetch", mockFetch(400, { error: "agentId 999 is not in your crew" }));
    const r = (await act("SYNDICATE_MOVE").handler(withSession, msg(), undefined, { orders: "[]" }, async () => {})) as any;
    expect(r.success).toBe(false);
    expect(r.text).toContain("agentId 999 is not in your crew");
  });

  it("translates rate limiting into a wait instruction", async () => {
    vi.stubGlobal("fetch", mockFetch(429, { error: "slow down — 30 calls/min" }));
    const r = (await act("SYNDICATE_MOVE").handler(withSession, msg(), undefined, { orders: "[]" }, async () => {})) as any;
    expect(r.text).toContain("Wait a minute");
  });
});

// ── provider ────────────────────────────────────────────────

describe("syndicate-game-state provider", () => {
  it("stays silent with no game, narrates from cache after one — with no fetch", async () => {
    const p = plugin.providers[0];
    expect((await p.get(rt("prov-cold"), msg(), undefined as any)).text).toBe("");
    vi.stubGlobal("fetch", mockFetch(200, VIEW));
    await act("SYNDICATE_NEW").handler(rt("prov"), msg(), undefined, undefined, async () => {});
    const f = mockFetch(200, VIEW);
    vi.stubGlobal("fetch", f); // fresh spy: provider must not touch it
    const out = await p.get(rt("prov"), msg(), undefined as any);
    expect(out.text).toContain("day 3");
    expect(out.text).toContain("$7500");
    expect(f).not.toHaveBeenCalled();
  });
});

// ── leaderboard ─────────────────────────────────────────────

describe("SYNDICATE_LEADERBOARD", () => {
  it("renders humans and flagged agents", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { scores: [
      { syndicate: "Las Sombras", headline: "cracked the vault", day: 38, value: 24500 },
      { syndicate: "Bot Family", headline: "fenced a slab", day: 12, value: 9000, agent: true, model: "claude-opus-5" },
    ]}));
    const r = (await act("SYNDICATE_LEADERBOARD").handler(rt(), msg(), undefined, undefined, async () => {})) as any;
    expect(r.text).toContain("1. Las Sombras — $24,500 (day 38) [human]");
    expect(r.text).toContain("[agent: claude-opus-5]");
  });
});
