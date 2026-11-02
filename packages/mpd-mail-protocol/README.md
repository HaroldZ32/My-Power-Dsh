# mpd-mail-protocol

**English** | [中文](./README.zh-CN.md)

The mail plane's shared, zero-dependency vocabulary: the `message` / `question` / `answer` envelope,
the pure validators that make an answer echo offered labels **verbatim**, the tolerant fold of the
append-only mailbox log, and the fan-out and thread helpers both planes need.

A LIBRARY, NOT A PLUGIN. There is no cordis row, no patch entry and no runtime dependency. The team
mailbox and the cellwork view import these rules from source, so there is exactly one definition of a
valid question or answer in the workspace.

## Why this package exists

A live cell run on 2026-10-31 measured the relay defect this package removes. `ask_user_question`'s
answer carries labels and no index, cellwork mail was free text, and every relayed "option number" was
composed by a model — so the number drifted between the asker, the panel and the answer, and the wrong
option was reported back as chosen.

The fix is structural, not a stronger instruction. **There is no index field anywhere.** A question's
labels are unique and carry their own stable ordinal (`A. …`, `B. …` or `1) …`), and an answer repeats
the offered label STRINGS. A mismatch is a string mismatch, so it can be refused mechanically — and the
refusal carries the full valid label list instead of making the sender guess.

## The envelope

```ts
type MailKind = "message" | "question" | "answer"

interface MailOption   { label: string; description?: string }
interface MailQuestion { questionId: string; header?: string; question: string;
                         options: MailOption[]; multiSelect?: boolean }
interface MailAnswer   { questionId: string; answerTo: string; selected: string[]; custom?: string }
interface MailEnvelope { kind: MailKind; replyTo?: string; threadId?: string;
                         question?: MailQuestion; answer?: MailAnswer }
```

`questionId` is stable across a broadcast's fan-out, so an answer names the question without naming a
row. A row written before this protocol existed has no `kind`; the fold reads it as `"message"`.

## The invariants (I1–I8)

| rule | what the package enforces |
|---|---|
| I1 | no payload carries an index-shaped field. Proven at COMPILE time (`MAIL_PAYLOADS_CARRY_NO_INDEX` covers the envelope, option, question, answer, send-record and folded-message shapes) and scanned at runtime by `findIndexFields` against an ENUMERATED denylist: `index`, `indexes`, `indices`, `optionIndex`, `optionIndices`, `selectedIndex`, `selectedIndices`, `optionNumber`, `optionNumbers`. **BOUND (amended after R1):** a positional field under another name (`position`, `choice`, `idx`) is not detected by the scan; containment comes from the fold's field whitelist and the mail tool schemas' `additionalProperties: false`, never from this scan alone. `selected` carries label strings only. |
| I2 | a question offers at least one option, every label is non-empty and unique within the question, and `questionId` is non-empty — it is the correlation key every answer copies. The ordinal prefix is the documented convention, not a checked shape. |
| I3 | a single-select answer selects exactly one label OR gives `custom` alone; label PLUS `custom` is refused. A multi-select answer selects at least one label and may add `custom`. |
| I4 | every selected string matches an offered label EXACTLY (no trim, no case folding). A mismatch is refused with the full valid label list. |
| I5 | `replyTo` / `answerTo` must reference a message id in the same folded mailbox, an answer's target must be a `question` row, and the answer's `questionId` must be non-empty and EQUAL to that question's `questionId` (amended after R1: a wrong key would otherwise pass every rule and void the answer). A `question` row whose payload is ABSENT — the fold keeps such a row and reports it — still REFUSES the answer: the missing payload is reported as `question-payload-missing` and the context-free answer rules run beside it, because the branch must never short-circuit to `ok` (R1's F3). |
| I6 | broadcast is a FAN-OUT: `fanOutTargets` returns one recipient per row (sender excluded, deduplicated); there is no multi-recipient row, so per-recipient ack and the undelivered bound stay honest. |
| I7 | a thread's id is its first message id; a reply without `threadId` inherits its `replyTo`'s thread, resolved by the fold in one pass. An explicit `threadId` naming no folded message (and not the row's own id) is kept as declared and REPORTED (amended after R1). |
| I8 | the fold reports every tolerated anomaly it can see: an unresolved `replyTo`, an explicit thread id with no root, a duplicated send id (FIRST write wins, declared), and each dropped/mismatched payload. Validators return the WHOLE problem list in one refusal. |

## Public API

- `validateEnvelope(envelope)` — I1 plus structural consistency (`kind` matches the payload it carries).
- `validateQuestion(question)` — I2, including the non-empty correlation key.
- `validateAnswer(answer, question?)` — I1/I3/I4 and the correlation key; without the question, the
  context-free rules still run (non-empty `questionId`/`answerTo`, a label list or `custom`, and the
  zero-label-zero-custom refusal).
- `validateReferences(envelope, messages)` — I5, I4 again once the referenced question is resolved, R1's
  F1 equality between the answer's `questionId` and the question's, and F3's payload-less target
  (`question-payload-missing` plus the context-free answer rules, never a silent `ok`).
- `foldMail(records)` — the tolerant fold: legacy `kind` default, I7 thread resolution, delivery/read
  state, unknown record kinds ignored, malformed rows skipped and reported, unresolved `replyTo` /
  explicit `threadId` reported, duplicate send ids keeping the FIRST write and reporting the duplicate,
  never a throw.
- `fanOutTargets(senderId, targets)` — the I6 recipient plan.
- `inheritedThreadId(envelope, byId)` — the I7 rule as a standalone helper; it does not validate an
  explicit id, because only the fold can see the whole mailbox.
- `findIndexFields(value)`, `labelsOf(question)` — the I1 scan and the I4 label list.
- `ordinalPrefix(index)`, `withOrdinal(index, text)` — the canonical label spelling (`A.` … `Z.`, then
  one-based numbering), so an asker never hand-writes an ordinal.

Every validator returns `MailCheck`: `{ ok: true }` or `{ ok: false, problems }`, where each problem
carries a stable `code` and, for I4, the `labels` list. A refusal names EVERY problem it found — one
round trip, not one problem at a time.

## Building and testing

Build from the REPOSITORY ROOT with the pinned toolchain, so the committed artifact matches the one the
freshness gate rebuilds with:

```
.toolchain/node_modules/.bin/bun build packages/mpd-mail-protocol/src/index.ts \
  --target node --format esm --outfile packages/mpd-mail-protocol/dist/index.js
bun test packages/mpd-mail-protocol
node scripts/verify-dist-fresh.ts
```

The unit tests pin I1–I8 one arm at a time: the compile-time and runtime no-index proofs, unique
labels, the verbatim echo (including the refusal's label list), single versus multi cardinality
(including the single-select label-plus-custom refusal), the correlation key's equality, the fan-out
row count, thread inheritance, the fold's declared first-wins duplicate policy, and fold tolerance
against junk, torn rows, an unresolved reference and a foreign record kind.
