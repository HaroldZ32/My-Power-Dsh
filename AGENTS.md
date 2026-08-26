# AGENTS.md — my-power-dsh Repository Gates & Git Workflow

## 1. Git Development/Release/Defect Separation Model

| Branch | Purpose | Rules |
|---|---|---|
| `master` | **Release line** (merge-only) | Written only by release flow; no direct dev commits or pushes |
| `dev` | **Integration line** | feature/fix branches converge here; full gates must pass on dev |
| `feature/<slug>` | New capabilities | Branch from dev; kebab-case; self-contained commits + evidence |
| `fix/<slug>` | **Defect fixes** | Branch from dev; one branch per defect; reproduction evidence + QA PASS required before merge |
| `release/vX.Y.Z` | Release preparation | Branch from dev; version/doc-only fixes; merged to master with a tag |

**Hard rules**
- No change may ever be pushed straight to `master`: feature/fix → dev → release → master.
- dev is green (bun test / tsgo / dsh-qa evidence) before any release.
- Commit format: `<type>(<scope>): <summary>`, type in feat/fix/docs/test/chore/release; fixes cite defect id/description.
- Remote pushes follow the same model: only feature/* → dev → release/v* → master (tags).

## 2. Engineering Gates

1. **Work only in this repository**: never modify/push upstream oh-my-openagent; vendor copies are read-only and pinned by VENDOR_LOCK.json.
2. **Plugin-form rule**: every deliverable is a cordis plugin (self-written plugin or an official-plugin instance in the bundle patch); no logic scattered in profiles, scripts, or the user home.
3. **Test gate**: each plugin package passes `bun test` + `tsgo --noEmit` before commit.
4. **QA gate**: runtime-behavior changes must run the matching `skills/dsh-qa` case (scripts ship `--self-test`); evidence goes to `evidence/<domain>/<slug>/`; no evidence = incomplete.
5. **Isolation rule**: QA boots with an isolated DSH_HOME (temp dir) and asserts isolation; never touch the real `~/.dsh`.
6. **Baseline rule**: OMO assets pinned by `VENDOR_LOCK.json` (commit + counts + sha/treeSha); verify with `scripts/verify-vendor.mjs` before any baseline change.
7. **Installer rule**: `scripts/install-profile.mjs` is the only channel that writes the user DSH_HOME (default --dry-run; --yes to write; --dsh-home for isolated QA).
8. **Language rule**: everything an agent reads — skills, docs, config comments, script output — is English; records may stay as produced.

## 3. Language Policy (binding)

- **From now on, all internal files are English-only**: docs, skills (SKILL.md + references), config
  comments, script strings, commit messages, README, package descriptions — English only.
- Chinese is allowed **only in external-facing documentation** (e.g., user-facing release notes or
  translated READMEs) and must be explicitly marked as external-facing content.
- Logs and evidence files are verbatim records (produced by runs) and keep whatever language the runs
  produced; new evidence should be English.
