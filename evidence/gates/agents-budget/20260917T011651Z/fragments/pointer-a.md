  **The adopted-plugin delta registry lives in `agent-references/agent-teams-deltas.md`**
  (open it on demand — it is not auto-injected): that file carries the authoritative A1–D26
  adaptation table (`evidence/wave2/adopted-tooling/result.json`, `adaptation_list`), the registry
  mechanics, the live region count and the wave-2 driver-script warning. Two rules from it stay
  binding here: (a) the registry is **derived** — regenerate it with `--write-registry`, never
  hand-edit an entry; (b) the **REPLACEMENT-shaped** deltas (the D13/D14/D21/D22 class) do **not**
  self-heal after a human re-materialize — the applier REFUSES loudly, file byte-untouched, and the
  remedy is to restore the region or re-author it plus `--write-registry`.

