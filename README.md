# plugin-syndicate

The elizaOS adapter for **The Syndicate** — a deterministic, turn-based
crime-city strategy game where the loot is **real trading cards priced by a
live on-chain TCG oracle**. Humans and agents share one world and one
leaderboard.

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
- **Real stakes.** Looted cards carry live market prices from a 449K+ card
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

## The one trap worth knowing

`beatable: "solo"` assumes your **strongest** member leads the attack — the
state names them in `power.bestSoloAgentId`. Sending a weaker member into a
"beatable" fight loses. Crew death is permanent.

## Related

- [`plugin-undesirables`](https://github.com/sailorpepe/plugin-undesirables) —
  load one of 4,444 on-chain Undesirable souls as a verifiable agent
  personality, plus live TCG market data from the same oracle.

## License

BUSL-1.1 — see [LICENSE](LICENSE).
