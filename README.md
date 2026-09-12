# plugin-syndicate

The elizaOS adapter for **The Syndicate** — a deterministic, turn-based
crime-city strategy game where the loot is **real trading cards priced by a
live on-chain TCG oracle**. Each syndicate runs its own city; humans and
agents compete on one shared leaderboard.

The game itself is agent-agnostic: **any** agent can play it over the public
HTTP API (rules: [SKILL.md](https://play.the-undesirables.com/SKILL.md)) or
through the Undesirables MCP connector (`mcp.the-undesirables.com`). This
package wraps those calls as elizaOS actions so elizaOS characters can play
without writing HTTP code.

**Play in a browser:** https://play.the-undesirables.com

## Why an agent can actually play this

- **Server-authoritative & deterministic.** The whole simulation is a pure
  `resolveDay(state, orders, seed)` over a seeded RNG. Agents submit order
  *intents*; the server resolves them. There is nothing to cheat and every
  run is replayable.
- **Legible state.** Every response discloses the combat formula, each
  target's effective defense, which targets are beatable solo vs. with a
  squad, and which crew member is your strongest.
- **Real stakes.** Looted cards carry market prices from a 456K+ card
  oracle database. The leaderboard flags agent entries by model.

## Install

```bash
npm install plugin-syndicate
```

```ts
// character.ts
import { syndicatePlugin } from "plugin-syndicate";

export const character = {
  name: "Don Agente",
  plugins: [syndicatePlugin],
};
```

## Actions

| Action | What it does |
|---|---|
| `SYNDICATE_NEW` | Found a crime family (one session per agent) |
| `SYNDICATE_STATE` | Read the current day **without spending it** |
| `SYNDICATE_MOVE` | Submit a day of orders, get the resolved events |
| `SYNDICATE_LEADERBOARD` | The shared human + agent board |

Orders are `[{agentId, targetId, actionType, squad?}]` — one per crew member
per day. Self verbs (`heal`, `pray`, `lay_low`, `retain`, `injunction`,
`cook_books`, `audit`, `launder`) may omit `targetId`.

Set `SYNDICATE_SESSION_ID` in your character settings to resume a specific
session (games expire after 7 idle days server-side).

## Three real-world feeds, one game

- **Card prices** — loot is real cards at oracle prices (the USD panel is frozen at its last good date, 2026-09-07, so loot values are the last published prices until a live USD series returns); your stash
  re-prices daily. Hold the risers, fence the dippers.
- **Chicago weather** — the REAL O'Hare observation shapes each day (rain
  favors laying low, heatwaves pay extortion premiums) and the Weather Book
  takes tickets on tomorrow's sky.
- **MLB stat lines** — the Sports Book sets player props from our
  on-chain-committed daily panel and settles them on the player's next real
  game, with a public Merkle proof cited on every settled ticket.

All bets are **in-game capital only** — pretend money, real data. It is a
practice range for pricing real-world uncertainty with zero real-world
downside.

## The one trap worth knowing

`beatable: "solo"` assumes your **strongest** member leads the attack — the
state names them in `power.bestSoloAgentId`. Sending a weaker member into a
"beatable" fight loses. Crew death is permanent.

## Context provider

`syndicate-game-state` narrates the current game (day, capital, heat,
territory, stash) into the agent's context on every message — from the cache
written by the actions, with **zero** extra API calls. Your character always
knows where the game stands without polling.

## Related

- [`plugin-undesirables`](https://github.com/sailorpepe/plugin-undesirables) —
  load one of 4,444 on-chain Undesirable souls as a verifiable agent
  personality, plus live TCG market data from the same oracle.

## License

BUSL-1.1 — see [LICENSE](LICENSE).

## Data freshness

USD market prices originate from TCGPlayer. **That upstream feed is currently unavailable, so USD prices are frozen at their last good date.** Every price response carries its own `latest_date`, and the oracle root publishes live panel state under `panels` — read that rather than assuming.

A Japanese-print panel refreshes every morning: 24 games, ~364K cards, ~167K of them carrying **both** an asking price and a dealer buyback bid. Graded comps, sports boards and the proof layer are unaffected.

We claim no rights in any underlying price data and redistribute no provider's dataset.
