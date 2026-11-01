STATUS: PARTIAL

# Lane `kb-node` — n8n-nodes-hermes: Kanban bridge support

**Blocking problem: `PLAN.md` was never delivered to this lane.** The lane prompt states "The plan
you implement (PLAN.md) is appended below your lane prompt" — nothing was appended. PLAN.md does not
exist anywhere on mbp-m2 (searched `~/Development`, `~/Documents`, `~/Desktop`, plus a filesystem-wide
grep for `kanban_task_moved|kanban/tasks|kanbanTask|kanban-bridge`). `~/Development/hermes-kanban-bridge/README.md`
points at `docs/PLAN.md`, but that repo is the bare "Initial skeleton" commit (83f0ea5) and contains only
`.gitignore`, `README.md`, `docs/reports/.gitkeep`, `plugin/.gitkeep`. No other branch, stash or ref holds it.

So I built the part of this lane that the **read-only Hermes source determines on its own**, and did not
invent the part that only PLAN.md can specify. Details in "Not built" below.
