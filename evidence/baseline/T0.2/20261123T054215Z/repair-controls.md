# Capture input and estimate controls

Run from the checkout under test.

```sh
sh evidence/baseline/T0.2/20261123T054215Z/repair-controls.sh
sh evidence/baseline/T0.2/20261123T054215Z/capture.sh --self-test
```

The original CLI measured a header containing a raw `0xff` byte inside its description exactly like the same header containing the correctly encoded `U+FFFD` character. Both exited 0 and reported 56 bytes. With the saved November and October inputs and `1e-320` bytes per token, the original CLI exited 0 and serialized both overflowed estimates as `null`.

| Repaired control | Exit | Observed result |
| --- | ---: | --- |
| Raw `0xff` | 3 | Fresh input reports `invalid UTF-8`. The historical capture still reports 117 tools. |
| Encoded `U+FFFD` | 0 | Fresh input measures one tool and 56 bytes. |
| `1e-320` bytes per token | 3 | The ratio is finite and positive. Applying it to either saved capture produces an unrepresentable estimate. Both captures report that reason. |
| `0.5` bytes per token | 0 | Fractional ratio accepted. Estimates are 112 and 186,378 tokens. |
| `1e-305` bytes per token | 3 | The small fresh fixture has a finite estimate. The historical capture’s estimate overflows. Only that side is unmeasured. |

All five controls and the saved comparison replay passed on Node `v24.21.0`. The focused strict TypeScript and declaration comment checks passed. The whole feature-worktree typecheck reported a separate `scripts/baseline/serial.ts(95,14)` argument-count error while another baseline repair was in progress. This packet changes only the tool-surface CLI and these replay controls.
