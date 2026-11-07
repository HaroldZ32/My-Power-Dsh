# Listing the bundle on the plugin directories

[中文](./market-listing.zh-CN.md)

Three directories matter, and they work differently: dshfind indexes GitHub, the DSH Go market takes
a pull request against a versioned catalogue, and the dsh-TUI ecosystem listing takes a pull request
against one `plugins.json`. This page records what each one needs, and where our submission files
live.

## dshfind

dshfind builds its marketplace from the GitHub topic **`dsh-plugin`**. Tag a public repository,
wait for the daily sync (02:17 UTC), and the plugin appears; there is no issue or pull request.

- The topic is set on this repository.
- The card is built from the repository description, the README and the topics, so the
  description has to say the same thing as the npm `description` and the README lead. When one
  changes, change all three.
- A repository that stays unlisted after two syncs is usually private, archived, or filtered as
  off-topic; that is the case to open an issue about.

## DSH Go market

The catalogue lives in `ccch1mneyyy/dsh-go-market`. One JSON file per plugin under `plugins/`:
`<name>.json` for an unscoped package, `@scope__name.json` for a scoped one. Our file is
[`docs/market/dsh-go-entry.json`](./market/dsh-go-entry.json) — copy it into that repository
when the version it names is on npm, then open a pull request against `main`. Checks run on the
pull request and merge automatically when they pass; risk features are reported to users rather
than blocking.

The entry carries exactly these fields:

| field | rule |
|---|---|
| `name` | the npm package name |
| `version` | one exact published version — never `latest`, never a range, never a git address |
| `title` | `{ "zh": …, "en": … }`; `en` is required |
| `summary` | `{ "zh": …, "en": … }`; one sentence each, `en` required |
| `category` | `tools`, `media`, `productivity`, `communication` or `other` |
| `screenshots` | HTTPS only, at most four |
| `homepage` | optional |

Do **not** submit `tier`, risk levels, integrity data or a review verdict: those are produced by
the catalogue's own scan, and official status comes only from its `policy.json`.

The scan blocks a submission when the exact version is missing from npm, the licence is not on
the OSI list, the archive exceeds 50 MiB packed or unpacked, the package identity, SHA-512 or
DSH bundle patch disagrees, the format-1 entry is invalid, or a high/critical advisory covers
that version. Ours is MIT and the bundle patch is declared in `package.json`, so the licence and
identity rules are satisfied by construction; the version rule means we submit after publishing.

### How the market knows the plugin has a native surface

It reads the same `dshGo` block the App reads, from `package.json`. A plugin is listed as adapted
when the block passes the SDK manifest schema **and** it contributes something real (a panel, a
strip, an action or a `dsh-go/view` in the source). An empty declaration stays `not-adapted`, and
`minApp` is taken from the manifest. We ship two panels, a strip, two composer actions, two
message actions and fourteen tool cards, so the block is not decorative; we declare no `minApp`
because older apps still get the `adaptView` fallback instead of nothing.

Passing the static check is not the same as having run in the App. That is what the screenshots
and the release notes are for.

## dsh-TUI ecosystem

The third directory is the dsh-TUI ecosystem listing. Its catalogue is `plugins.json` in the
repository `dsh-tui-ecosystem/dsh-tui-ecosystem`. One entry is added by a pull request against `main`:
a workflow runs the validator, an optional AI review follows, and a `MERGE_TOKEN` squash-merges the
pull request once both are done.

The validator is `.github/scripts/validate-plugins.mjs`, and it makes five machine checks:

1. `plugins.json` is valid JSON and `plugins` is an array.
2. Every entry requires `name`, `displayName`, `description`, `author`, `repo`, `kind` and `addedAt`,
   and `kind` must be `plugin`, `template` or `core`.
3. `repo` must match `https://github.com/owner/repo`, and both the plugin name and the repo URL must
   be unique case-insensitively.
4. For a NEW entry, the repository must exist and be public, and the PR author must be that
   repository's owner or a collaborator.
5. For a NEW entry, the repository README must contain `https://dshtui.com` or
   `https://github.com/ccch1mneyyy/dsh-tui`.

Two details bite. The validator LOWERCASES the README before matching, so `dsh-TUI` in our README
satisfies check 5. And it reads the README from the repository's DEFAULT BRANCH, which for us is
`master` — a backlink that exists only on `dev` does not satisfy check 5.

Our entry is
[`docs/market/dsh-tui-ecosystem-entry.json`](./market/dsh-tui-ecosystem-entry.json). That file is ONE
entry object, not the whole catalogue: append it to the `plugins` array of `plugins.json` in a pull
request against `main`. The entry carries exactly these fields:

| field | rule |
|---|---|
| `name` | the plugin name, unique case-insensitively |
| `displayName` | the card title |
| `description` | one sentence in Chinese, usually ending with the install command |
| `author` | the GitHub account that submits the entry |
| `repo` | `https://github.com/owner/repo` |
| `npm` | the npmjs.com package URL, or `null` |
| `tags` | a short list of Chinese or English tags |
| `kind` | `plugin`, `template` or `core` |
| `featured` | `true` or `false`; reserved for the catalogue's own selection |
| `addedAt` | the submission date, `YYYY-MM-DD` |

A listing is not an endorsement: **收录 ≠ 准入 ≠ 背书**. An entry says only that the repository is
public, that its author submitted it, and that its README links back. The validator checks nothing
else — not whether the package is on npm, not whether the name is bare or scoped, not whether a
`dsh-plugin.json` exists, not whether the manifest parses, not provenance, and not declared
capabilities. Treat the listing as a pointer to a public repository, never as a review of it.

Naming is not a gate either. The guide calls `@dsh-tui-ecosystem/<name>` and
`github.com/dsh-tui-ecosystem/<name>` an 生态约定, and says explicitly 不要求组织仓库 and 不因命名被拒.
Our package stays `@mpd-dsh/mpd` in `HaroldZ32/My-Power-Dsh`.

Against the five checks: 1, 2, 3 and 4 pass — the repository is public and MIT, `v0.17.5` is tagged
and published, and the pull request would come from the repository owner. Check 5 was the one miss,
and the README backlink that closes it now exists.

## What we still owe before submitting

1. Bring the DSH Go entry up to the published version. The checked-in entry still names `0.17.0` while
   the bundle is at `0.17.5`; bump that entry's `version` in the same change that publishes a release,
   and never ship an entry whose exact version is missing from npm.
2. Carry the README backlink to `master`. The dsh-TUI validator reads the README from the default
   branch, so a backlink merged only to `dev` leaves check 5 failing; the release that carries this
   README is what turns it green.
3. Put real screenshots in `docs/assets/` and reference their HTTPS URLs (four at most).
4. Keep the repository description, the npm `description`, the `dshGo` titles and the README lead
   saying the same thing — the three directory cards quote them independently.
