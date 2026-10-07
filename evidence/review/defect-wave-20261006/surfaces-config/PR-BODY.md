## English

### What this fixes

Nine source defects **and the three red gates the whole wave started from**. This is the branch that
turns a measurement into a green tree:

| Gate | Before | After |
|---|---|---|
| `bun run test:qa` | **FAIL — 3 of 48 cases** | **`all self-tests passed`** (48/48) |
| `bun run typecheck` | **FAIL — 4 errors** | **exit 0** |
| `node scripts/verify-pack-closure.ts` | **FAIL — 2 TREE-DRIFT** | **ok — 0 TREE-DRIFT, 0 drift** |

**In all three cases the stale side was the CASE, not the code** — which is exactly why a bare red/green
reading would have misled, so each was diagnosed before it was touched:

- **G1 `bundle-lifecycle`** asserted a column-0 `- id: agent-preset-registry` that `9e91beb3` (zero host
  overrides, dev-only) deliberately removed, because that id is **host-owned** and
  `verify-no-host-override.ts` fails such a row.
  *Falsifier proven end-to-end*: appending the id-target to the **real** `cordis.patch.yml` reddened the
  case; the file was restored byte-identically (sha256 compared).
- **G2 `extension-lifecycle`** demanded `/FATAL/` on the row's **stdout** — which **directly contradicts
  R5** ("no MPD diagnostic may reach the terminal"), gated by
  `packages/mpd-dsh-adapter-plugin/test/no-terminal-writes.test.ts`. A row satisfying the old case would
  *fail* the R5 gate. R5 wins. *Falsifier, both directions*: removing the log append reddens the file
  half; adding one `console.log` reddens the terminal half while the file half stays green.
- **G3 `preset-register`**'s fixture named `dist/cli.js` after `7c1076f3` moved the operand to
  `dist/launch.js`. The legacy file **still exists on disk and is a pinned VENDOR_LOCK asset** — which is
  why the loop's `existsSync` leg passed and only the operand match failed.

**G4** took the preferred route — **resolution, not exclusion**: the loader tries the caller's own
`typescript` first and `@typescript/native-preview` second, with a new `typescript-unstable.d.ts` mapping
the same specifiers on the type side. **Nothing was excluded from the tsconfig program.**

### Source findings (9)

| # | Severity | Defect |
|---|---|---|
| S1 | med | the config bridge wrote `<root>/.mpd/mpd.jsonc` while the read path used `projectFile` — the knob was unhonoured and `resolveTargets`'s parameter was dead in production |
| S2 | med | the adapter's engine memo never evicted, so a **dead** agent's realm engine was handed to a caller asking for the live member |
| S3 | med | `resolveDshAdapter` silently built a **second adapter instance** beside the mounted one (16 rows) with no diagnostic, while the lazy twin warns |
| S4 | low | `adapterIdentity` was frozen at apply, contradicting its own "never cached at apply" contract |
| S5 | low | the fs watcher's disposer was stored and never registered in the row's scope |
| S6 | low | `capText` exceeded its declared cap (8217 for an 8192 cap) |
| S7 | low | a **refused** panel registration read as "this host exposes no panel seam" |
| S8 | low | a blank-but-**set** env value suppressed its documented alias |
| S9 | low | the sidebar diagnostics snapshot was never republished on the late-bind path |

S3 deliberately **keeps the fallback semantics** — the finding was about the silence, not about removing
the fallback. Its diagnostics go through `rowLogLine` (the row's own file log), so R5's
`no-terminal-writes` gate stays green — that gate is what would have caught the tempting "fix" of
printing to stdout.

### Measured evidence

`evidence/review/defect-wave-20261006/surfaces-config/VERIFICATION.md`, measured on the branch tip after
both writers stopped **and after the re-pin**:

`verify-dist-fresh` **29/29 fresh** · `verify:comments` **PASS** · `verify:docs` **PASS** ·
`verify-rows-parity` ok(33) · `verify-no-host-override` **PASS** · `verify-manual-paths` **PASS** ·
`verify:manifest` **PASS** · suites **774 pass / 0 fail** (config 94, adapter 182, ext 77, workmate 46,
tui 222, codegraph 12, bundle 141).

Every finding was pinned **PIN → RED → GREEN**; representative REDs:

```
S1  expect(report.writtenTo).toEqual([override])  ->  Received <ws>/.mpd/mpd.jsonc
S2  Received { realm: "incarnation-1" }  where undefined was expected
S3  expect(lines.length).toBe(1)  ->  Received 0   (both fallback arms)
S6  cap 8192 exceeded — Expected: <= 8192, Received: 8217
S7  expect(routed.outcome).toBe("refused")  ->  Received "unavailable"
S9  expect(sidebarDiagnostics()).toMatchObject({host:'dsh-better-sidebar',preferred:true})
    ->  Received {host:'', preferred:false, registered:0, reported:false}
```

### The wave's single `VENDOR_LOCK` re-pin (§9)

The `skills/**` edits invalidated the corpus `treeSha`, so the re-pin lands in the **same commit** as the
change that invalidated it — a captain step (`repin-vendor.ts --write` refuses without
`--i-know-this-is-the-captains-step`):

```
skills.fileCount  334 -> 335
skills.treeSha    501534fa… -> f8d30d96…
dry run after:    0 asset(s) would be re-pinned
```

### Honest bounds

- **The three cases' REAL arms remain red in this sandbox** for pre-existing/environmental reasons — no
  `tool/call` evidence for `mpd_ext_list`, and a read-only pnpm store
  (`ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`). Both reproduce on evidence predating this wave. **Do not
  read them as a pass**; the `--self-test` arms are what this branch turns green.
- `verify-vendor` cannot run here at all (no `MPD_UPSTREAM_ROOT`) — it is the only member that reddens
  `verify:gates` (7/8).
- **S7 residual**: the `"requested"` state (bound seam, no panel read-back) still prints the "no panel
  seam" sentence — pre-existing, outside S7's wording.
- **INTEGRATION BOUND**: `dist/mpd-package` is derived from the source tree, so a re-pack inside ONE
  branch is current only for THAT branch's tree. After all three branches merge, **one more `npm run
  pack` must land at integration** — three divergent trees cannot share one green pack.
- **Build trap**: PATH bun here is **1.4.2** and renders the committed dists STALE; the pinned **1.4.0**
  is `.toolchain/bun/bin/bun`. The adapter edit fanned out to **22 stale dist targets** plus
  `packages/mpd-bundle-plugin/client.js`, all rebuilt with the pin.

---

## 简体中文

### 本 PR 修了什么

修掉 9 个源码缺陷，**以及整波工作的起点——那三个红灯闸门**。正是这条分支把「一次测量」变成「一棵绿树」：

| 闸门 | 之前 | 之后 |
|---|---|---|
| `bun run test:qa` | **FAIL —— 48 个里 3 个红** | **`all self-tests passed`**（48/48） |
| `bun run typecheck` | **FAIL —— 4 个错误** | **exit 0** |
| `node scripts/verify-pack-closure.ts` | **FAIL —— 2 个 TREE-DRIFT** | **ok —— 0 TREE-DRIFT，0 drift** |

**三处都是「用例」过时，不是代码**——这正是单看红/绿会误导的原因，所以每一条都先诊断、再动手：

- **G1 `bundle-lifecycle`** 断言 bundle patch 里有列 0 的 `- id: agent-preset-registry`，而 `9e91beb3`（zero host
  overrides，仅 dev）已刻意删除它——那个 id 是**宿主所有**，`verify-no-host-override.ts` 会让这种行失败。
  *反证已端到端跑通*：把该 id-target 追加进**真实的** `cordis.patch.yml` 会让用例变红；随后文件被逐字节还原
  （sha256 比对）。
- **G2 `extension-lifecycle`** 要求行在 **stdout** 打印 `/FATAL/`——这与 R5（「MPD 诊断不得触达终端」）**直接冲突**，
  而 R5 由 `packages/mpd-dsh-adapter-plugin/test/no-terminal-writes.test.ts` 把守。满足旧用例的行会**违反** R5 闸门。
  R5 胜出。*双向反证*：去掉日志追加会让「文件半边」变红；在 FATAL 路径上加一个 `console.log` 会让「终端半边」变红，
  而文件半边仍绿。
- **G3 `preset-register`** 的 fixture 在 `7c1076f3` 把 operand 挪到 `dist/launch.js` 之后仍写着 `dist/cli.js`。
  那个旧文件**仍在磁盘上且是被钉住的 VENDOR_LOCK 资产**——这正是循环里 `existsSync` 那一腿通过、只有 operand 比对失败的原因。

**G4** 走的是首选路线——**修解析，而不是排除**：加载器先试调用方自己的 `typescript`，再试 `@typescript/native-preview`，
并新增 `typescript-unstable.d.ts` 在类型侧映射同样的两个说明符。**没有把任何东西排除出 tsconfig 程序。**

### 源码缺陷（9 条）

| # | 级别 | 缺陷 |
|---|---|---|
| S1 | med | config 桥写的是 `<root>/.mpd/mpd.jsonc`，而读路径用 `projectFile`——旋钮没被兑现，`resolveTargets` 的参数在生产里是死参 |
| S2 | med | adapter 的 engine memo 从不淘汰，**已死** agent 的 realm engine 被交给索取活成员的调用方 |
| S3 | med | `resolveDshAdapter` 在挂载的 adapter 旁边**静默新建第二个实例**（16 处调用），而 lazy 孪生路径会大声告警 |
| S4 | low | `adapterIdentity` 在 apply 时被冻结，与它自己「绝不在 apply 时缓存」的契约矛盾 |
| S5 | low | fs watcher 的 disposer 存了却从未注册进行自身的作用域 |
| S6 | low | `capText` 超出它声明的上限（上限 8192，实际 8217） |
| S7 | low | 被**拒绝**的 panel 注册被读成「本宿主没有 panel seam」 |
| S8 | low | 空白但**已设置**的环境变量压制了它文档化的别名 |
| S9 | low | 迟到绑定路径上，sidebar 诊断快照从未重新发布 |

S3 **刻意保留回退语义**——这条缺陷说的是「静默」，不是要删掉回退。它的诊断走 `rowLogLine`（行自己的文件日志），
因此 R5 的 `no-terminal-writes` 闸门保持绿——那条闸门正是用来抓住「打印到 stdout」这种诱人但错误的修法。

### 实测证据

`evidence/review/defect-wave-20261006/surfaces-config/VERIFICATION.md`，在两位写手都停下**且重新打包之后**于分支尖端测量：

`verify-dist-fresh` **29/29 fresh** · `verify:comments` **PASS** · `verify:docs` **PASS** ·
`verify-rows-parity` ok(33) · `verify-no-host-override` **PASS** · `verify-manual-paths` **PASS** ·
`verify:manifest` **PASS** · 测试套件 **774 pass / 0 fail**（config 94、adapter 182、ext 77、workmate 46、
tui 222、codegraph 12、bundle 141）。

每条缺陷都走了 **PIN → RED → GREEN**；代表性 RED：

```
S1  expect(report.writtenTo).toEqual([override])  ->  Received <ws>/.mpd/mpd.jsonc
S2  Received { realm: "incarnation-1" }          应为 undefined
S3  expect(lines.length).toBe(1)  ->  Received 0   （两个回退分支都是）
S6  cap 8192 exceeded — Expected: <= 8192, Received: 8217
S7  expect(routed.outcome).toBe("refused")  ->  Received "unavailable"
S9  expect(sidebarDiagnostics()).toMatchObject({host:'dsh-better-sidebar',preferred:true})
    ->  Received {host:'', preferred:false, registered:0, reported:false}
```

### 本波唯一一次 `VENDOR_LOCK` 重新钉定（§9）

`skills/**` 的改动让语料 `treeSha` 失效，因此重新钉定与「导致它失效的那次改动」落在**同一个提交**——这是 captain 步骤
（`repin-vendor.ts --write` 没有 `--i-know-this-is-the-captains-step` 会拒绝）：

```
skills.fileCount  334 -> 335
skills.treeSha    501534fa… -> f8d30d96…
写入后 dry run：  0 asset(s) would be re-pinned
```

### 诚实的边界

- **三个用例的「真实运行」在本沙箱里仍是红的**，原因是既有的/环境的：`mpd_ext_list` 没有 `tool/call` 证据；pnpm store 只读
  （`ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`）。两者在早于本波的证据里就可复现。**不要把它读成通过**；本分支转绿的是
  `--self-test` 那半边。
- 本机完全无法运行 `verify-vendor`（没有 `MPD_UPSTREAM_ROOT`）——它是唯一让 `verify:gates` 变红的成员（7/8）。
- **S7 残留**：`"requested"` 状态（seam 已绑定但宿主没有 panel 读回）仍打印「无 panel seam」那句——既有问题，不在 S7 措辞范围内。
- **集成边界**：`dist/mpd-package` 由源码树派生，所以在**单条**分支里重新打包，只对该分支的树有效。三条分支全部合并后，
  集成处**必须再跑一次 `npm run pack`**——三棵分叉的树不可能共用一个绿的包。
- **构建陷阱**：本机 PATH 上的 bun 是 **1.4.2**，会把已提交的 dist 判为 STALE；钉住的 **1.4.0** 在 `.toolchain/bun/bin/bun`。
  adapter 改动扇出到 **22 个过期 dist 目标**外加 `packages/mpd-bundle-plugin/client.js`，全部用钉住的版本重建。
