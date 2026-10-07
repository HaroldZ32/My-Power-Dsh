# The npm publish, verified by reading the registry back

`@mpd-dsh/mpd@0.12.0`, published 2026-10-07. This note records what was OBSERVED, because "published"
is a claim and the registry is the witness.

## Identity — the registry's bytes are the tree's bytes

| Fact | Registry | Local |
|---|---|---|
| `dist.shasum` | `8164dcd4a9c6759e5be86f5c62490ae7bb694cfa` | `8164dcd4a9c6759e5be86f5c62490ae7bb694cfa` |
| `dist.integrity` | `sha512-ehkSwNQ6SNMmZJqcoBSsqntoxU3XpoToe…` | `sha512-ehkSwNQ6SNMmZ[…]/3TVXw==` |
| files | 889 | 889 |
| unpacked size | 22.9 MB | 22.9 MB |
| tarball size | 7.3 MB | 7.3 MB |
| `_npmUser` | `anger3140` | — |

The shasum matches **exactly**, so what is on the registry is the artifact this repository produces —
not a re-pack, not a different commit.

## Visibility — public, and anonymously installable

The README tells a stranger to run `dsh plugin --profile web add @mpd-dsh/mpd`, which is only true if
the package is public. All three checks say it is:

```
anon  GET https://registry.npmjs.org/@mpd-dsh%2Fmpd              -> HTTP 200
anon  GET https://registry.npmjs.org/@mpd-dsh/mpd/-/mpd-0.12.0.tgz -> HTTP 200
      npm access get status @mpd-dsh/mpd                          -> "@mpd-dsh/mpd: public"
```

A scoped package defaults to RESTRICTED when published without `--access public`, so this was worth
checking rather than assuming — a restricted package would have made the README's primary install
command false for everyone outside the org.

## `latest` points at this release

```
GET https://registry.npmjs.org/-/package/@mpd-dsh%2Fmpd/dist-tags
{"latest":"0.12.0"}
```

## Two reading traps this note exists to correct

1. **The packument 404s for a while after a successful publish.** Immediately after the publish,
   `GET /@mpd-dsh%2Fmpd` returned **404** for several minutes while
   `GET /@mpd-dsh%2Fmpd/0.12.0` returned **200** and the authenticated packument also returned 200.
   A 404 on the package document is therefore NOT evidence that the publish failed — read the
   VERSION document, the dist-tags endpoint, or the authenticated route before concluding anything.
   This cost a round-trip with the user, who had in fact published correctly.
2. **`npm publish` needed an interactive one-time password.** The account has 2FA enabled and the
   token in `~/.npmrc` does not bypass it (`EOTP`), so the publish was performed by the maintainer
   rather than by the release driver. Recorded here because a release script that assumes a
   non-interactive publish will stop at exactly this point.

## What this does NOT claim

- Not that the package INSTALLS and MOUNTS — that is the oneclick Docker lane's job
  (`node scripts/docker-e2e.ts --mode oneclick --spec @mpd-dsh/mpd@0.12.0 --require-docker`), and its
  verdict is recorded separately.
- Not that the package contents are correct beyond their identity: the shasum proves the registry
  carries THIS tree's bytes; `verify:manifest --pack` and the pack-closure gate are what prove those
  bytes are the right ones.
