# n8n community node

## Overview
This is a project containing code for an n8n community node. n8n is a workflow
automation platform where users build workflows with nodes, which are the
building block of a workflow. Nodes can perform a range of actions, such as
starting a workflow (called a "trigger node"), fetching and sending data, or
processing and manipulating it. Besides that there are credentials - entities
that store sensitive information on how to connect to external services and
APIs. A node can require some credentials to be used. Community nodes are a way
for anyone to create such nodes and add them to be used in n8n. All community
nodes are named in a format: `n8n-nodes-<n>` or `@org/n8n-nodes-<n>`.
Community nodes can also be submitted for approval to be used on n8n Cloud
version. In that case there are rules that the node needs to follow in order to
be approved

## Important notes
- Follow the **rules and guidelines in this document and the linked docs
  below** over any code examples.
- All code blocks in these docs are **illustrative and incomplete**.
  They **MUST NOT** be copied verbatim or assumed to be the final desired code.
- Replace example names like `Example`, `Wordpress`, `wordpressApi`, etc.
  with names that match the **actual service / node** you are building.
- When in doubt, **generalize from the patterns**, don't replicate the exact
  structure, fields, or values from the examples.
- Produce the **full implementation** needed for the current project
  (nodes, credentials, tests, etc.), not just fragments similar to examples.
- If an example omits parts (e.g. types, operations, properties), **infer and
  implement the missing parts** based on the real requirements / API docs.
- Never output `Wordpress`-specific code unless the project is actually about
  WordPress.

## Project structure
There are two main folders in this project:
- `nodes` contains all of the nodes in a package (there can be more than 1).
  The code for each node usually lives in its own folder
- `credentials` contains all of the credentials in a package. Usually it's just
  a single file for every credential
So it looks something like this:
.
├── nodes/
│   └── Example/
│       ├── Example.node.ts
│       └── ...
├── credentials/
│   └── Example.credentials.ts
├── package.json
└── ...
It's important to note that `package.json` has a special field `n8n` that have
information about nodes and credentials in a package:
```json
{
  "name": "n8n-nodes-example",
  "version": "1.0.0",
  "n8n": {
    "n8nNodesApiVersion": 1,
    "strict": true,
    "credentials": [
        "dist/credentials/Example.credentials.js"
    ],
    "nodes": [
      "dist/nodes/Example/Example.node.js"
    ]
  }
}
```
`nodes` and `credentials` keys contain paths to transpiled JS files in a `dist`
folder for the nodes and credentials respectively. If you add/remove/rename
nodes and/or credentials, you need to make sure to update `n8n.nodes` and
`n8n.credentials` keys in `package.json` accordingly. Initial files in the
project _may_ contain example nodes and/or credentials that need to be
**removed or renamed** once you start making an actual node.

## Key guidelines
- Use the `n8n-node` CLI tool **whenever possible** for building, dev mode,
  linting, etc.
- **Always** address any lint/typecheck errors/warnings, unless there is a
  **very specific reason** to ignore/disable it
- Make sure to use **proper types whenever possible**
- If you are updating the npm package version, make sure to **update
  CHANGELOG.md** in the root of the repository
- Read `.agents/workflow.md` for more info

## Context-specific docs
Load these before working on the relevant area:

| Working on...                        | Read first                                                          |
|--------------------------------------|---------------------------------------------------------------------|
| Any node file in `nodes/`            | `.agents/nodes.md` and `.agents/properties.md`                      |
| A declarative-style node             | above + `.agents/nodes-declarative.md`                              |
| A programmatic-style node            | above + `.agents/nodes-programmatic.md`                             |
| Files in `credentials/`              | `.agents/credentials.md`                                            |
| Adding a new version to a node       | `.agents/versioning.md`                                             |
| Starting a new task or planning      | `.agents/workflow.md`                                               |

## Additional resources
If you need any extra information, here are links to n8n's official docs
regarding building community nodes:
- https://docs.n8n.io/integrations/community-nodes/build-community-nodes/
- https://docs.n8n.io/integrations/creating-nodes/overview/
- https://docs.n8n.io/integrations/creating-nodes/build/reference/
- https://docs.n8n.io/integrations/creating-nodes/build/reference/ux-guidelines/

## Kanban capability: kanban-devbox required

This package's Kanban Task resource and bridge trigger are part of the Hermes kanban capability. **Every build or test that touches kanban (boards, the bridge, the Acquisitions/process workflows) runs in a kanban-devbox run** (CLI on the Mac mini, skill `kanban-devbox`). The rules below are copied verbatim from `ejlevin1/kanban-devbox` `docs/agent-rules.md` (v0.1.1); fix them there, then re-copy.


**If you are changing `hermes-kanban-tasks`, `hermes-kanban-bridge`, `n8n-nodes-hermes`, the
`Acquisitions · *` workflows, the `acq_*`/`proc_stages` tables, or adding a new process on
kanban-tasks — you build it in a kanban-devbox run. Not against live.**

The `kanban-devbox` skill and each repo's `AGENTS.md`/`CLAUDE.md` copy this file. It is the
source; fix it here.

---

### 1. The shape of a build

```sh
# 1. open a sandbox. Everything it creates carries the run's 4-hex short id.
eval "$(kanban-devbox up --purpose <what-you-are-building> \
          --live-board acquisitions \
          --fork 'Acquisitions · events' --fork 'Acquisitions · screen' \
          --tables acq_deals --tables proc_stages \
          --secret-env KANBAN_BRIDGE_N8N_DEV_SECRET)"
# -> KD_RUN, KD_SHORT, KD_BOARD_<P>, KD_TABLE_<T>, KD_WF_<NAME>, KD_TARGET, KD_TOKEN_FILE, KD_TMP

# 2. build and test against the dev copies only. Record anything else you create.
kanban-devbox add card "$KD_RUN" "try the new stage gate" --board "$KD_BOARD_..."
kanban-devbox heartbeat "$KD_RUN"          # at least every 30 min, or sweep may reclaim it

# 3. when it works, take the live lease and promote.
kanban-devbox lease acquire "$KD_RUN" "<live workflow id>" --kind workflow
kanban-devbox promote "$KD_RUN" "<live workflow id>" --dry-run   # read it first
kanban-devbox promote "$KD_RUN" "<live workflow id>"

# 4. tear it down and prove it.
kanban-devbox down "$KD_RUN"
kanban-devbox verify-clean "$KD_RUN"       # non-zero means you are not done
```

**A build is not finished until `verify-clean` exits 0.** That is the whole contract.

### 2. Never touch live directly

| Don't | Do |
|---|---|
| edit an `Acquisitions · *` workflow in the n8n UI | `--fork` it, edit the `KD <short> · …` copy, `promote` |
| write to `acq_*` / `proc_stages` | `--tables` a copy, or `promote-table-rows` with `--key` |
| create a card on `acquisitions` | create it on the run's own `kd-<short>-…` board |
| `kbctl token create` by hand | `up` mints one scoped to the run's boards |
| add a target to `config.yaml` by hand | `kanban-devbox add target` (it takes the global lock) |
| `ktctl config set boards …` | `up` appends the run's board additively |

There is exactly one exception, and it is `promote`. It refuses unless you hold the live lease
**and** the live workflow's `versionId` still matches what the fork was taken from, and it
refuses again if any `kd-`/`KD `/`kd_` string survived the un-rewrite.

### 3. Never touch these at all

The investing build (`inv-*`, `invest-*`, `Invest · *`), tool-approvals, `hermes-config`, and
any board, workflow or table not named in section 2. They are other people's builds.

### 4. Parallel lanes

Another agent is probably running right now. What that means for you:

* **Use your own run.** Never `add` to, `promote` from, `down` or `heartbeat` a run id that is
  not yours — `kanban-devbox status` shows who owns what.
* **Heartbeat.** `sweep` protects an open run with a heartbeat under 30 minutes old. A run that
  stops beating looks exactly like a crashed one, because it usually is.
* **Take the lease before you change anything live**, and expect to wait. The error names the
  run and the owner holding it and when it expires. Don't take over a live lease; if it is
  expired, the takeover is logged and the other agent will see it in `status`.
* **Never kill by pattern.** No `pkill -f`, no `tmux kill-session -a`, no `git branch -D` of
  anything whose name you did not check. Kill only a PID you saved.
* **Cards spawn real workers.** The dispatcher's 4-per-profile cap is shared with the live
  boards, so a run is capped at 5 cards (`--max-cards` to raise it) and `up` warns when a live
  board already has workers running.

### 5. Secrets

* The bridge token's plaintext exists in exactly one place: the 0600 file `up` wrote, named by
  `KD_TOKEN_FILE`. **Never `cat` it into a transcript, a card, a commit or a log.** Move it into
  the n8n credential and delete the file.
* A push target's shared secret comes from the profile `.env` via `secret_env`. An inline
  `secret:` key is refused by the bridge itself — don't try.
* The n8n API key is read from the file named by `KD_N8N_API_KEY_FILE`. Don't echo it.
* Test data is synthetic: `kbb_test_…` tokens, `Alex Example`, `@example.invalid` addresses. No
  real deal names, no real email addresses, no real hostnames beyond `mbp-m2` and the Mac mini.
* Real email sends go to Eric only, subject-prefixed `[KD <short>]`.

### 6. If something goes wrong

| Situation | What to do |
|---|---|
| a lane crashed mid-`up` | `kanban-devbox down <run>` — the manifest records the intent *before* each create, so the undo is there even for a resource the dead process never finished making |
| you don't know what is out there | `kanban-devbox sweep --older-than 0s` (report only; it never removes without `--apply`) |
| a stale lease is in your way | wait for it, or let it expire and take it over — the takeover is recorded |
| `down` reports a leftover | fix the cause and re-run `down`; it is idempotent. `--force` stops waiting for the run's board workers |
| `verify-clean` says *unverified* | that is not clean. n8n or mbp-m2 could not be reached, so nobody knows. Fix the connection and ask again |
| a promote is refused as *live changed since fork* | someone edited live. Re-fork from current live and redo your change on top; do not override |

### 7. What you must not add

Don't add policy, failsafes, auto-deletion or features the plan you are working from does not
specify. The weekly sweep cron is **notify only** by decision (V4) — don't make it `--apply`.
Write ideas down instead; they are cheap to propose and expensive to undo.
