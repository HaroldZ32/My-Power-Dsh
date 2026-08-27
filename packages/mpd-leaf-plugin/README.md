# mpd-leaf-plugin

Leaf layer of the Plan F invocation model.

- `mpd_leaf_iterate`: spawn a one-shot leaf (persona = an mpd-* OMO preset text; toolFilter
  denies delegation + team tools) in fresh rounds; each round is fed the previous round's
  compact report; termination = the real project gate (`mpd_gate_run`) passes or the round cap
  is hit. Evidence per run under `.mpd/leaf/<id>/run.json`.
- `mpd_gate_run`: run the repo gate suite (bun test / tsgo with the 108-error debt baseline /
  dsh-qa self-test) and return structured ok/exit/tail per gate.

Advisor bases (oracle/librarian/explore/metis/momus/prometheus/multimodal-looker) are
read-only leaves: they get an extra deny list (write/edit/bash/...) and skip the gate
requirement. Executor bases (sisyphus/hephaestus/sisyphus-junior) must pass gates.
