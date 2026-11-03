# Listing the bundle on the plugin directories

[中文](./market-listing.zh-CN.md)

Two directories matter, and they work differently: dshfind indexes GitHub, the DSH Go market
takes a pull request against a versioned catalogue. This page records what each one needs, and
where our submission file lives.

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

## What we still owe before submitting

1. Publish the version the entry names, and bump the entry's `version` in the same change.
2. Put real screenshots in `docs/assets/` and reference their HTTPS URLs (four at most).
3. Keep the repository description, the npm `description`, the `dshGo` titles and the README lead
   saying the same thing — the three directory cards quote them independently.
