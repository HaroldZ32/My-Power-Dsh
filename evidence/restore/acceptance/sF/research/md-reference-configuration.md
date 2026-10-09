> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coderabbit.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Configuration reference

> Complete reference for CodeRabbit configuration options with detailed explanations, types, and examples.

<Info>
  This reference is automatically generated from the CodeRabbit configuration schema. **Last updated: October 7, 2026**
</Info>

CodeRabbit's behavior can be customized using a `.coderabbit.yaml` file in your repository root. This reference covers all available configuration options with clear property names and examples.

<CardGroup cols={2}>
  <Card title="Quick Start" icon="rocket" href="/getting-started/yaml-configuration">
    Get started with basic configuration
  </Card>

  <Card title="YAML config examples" icon="file-code" href="https://github.com/coderabbitai/awesome-coderabbit/tree/main/configs">
    Browse example configurations
  </Card>
</CardGroup>

## Configuration sections

<CardGroup cols={2}>
  <Card title="General settings" icon="flag" href="#general-settings">
    Configure general settings
  </Card>

  <Card title="Code reviews" icon="git-pull-request" href="#reviews">
    Configure automatic code reviews, tools, and review behavior
  </Card>

  <Card title="Chat" icon="message-circle" href="#chat">
    Configure interactive chat features
  </Card>

  <Card title="Knowledge base" icon="brain" href="#knowledge-base">
    Configure knowledge base features
  </Card>

  <Card title="Code generation" icon="code" href="#code-generation">
    Configure code generation settings
  </Card>

  <Card title="Issue enrichment" icon="sparkles" href="#issue-enrichment">
    Configure automatic Issue enrichment and planning
  </Card>
</CardGroup>

## General settings

<ResponseField name="language" type="enum">
  Set the language for reviews by using the corresponding ISO language code.

  One of the following: `de`, `de-DE`, `de-AT`, `de-CH`, `en`, `en-US`, `en-AU`, `en-GB`, `en-CA`, `en-NZ`, `en-ZA`, `es`, `es-AR`, `fr`, `fr-CA`, `fr-CH`, `fr-BE`, `nl`, `nl-BE`, `pt-AO`, `pt`, `pt-BR`, `pt-MZ`, `pt-PT`, `ar`, `ast-ES`, `ast`, `be-BY`, `be`, `br-FR`, `br`, `ca-ES`, `ca`, `ca-ES-valencia`, `ca-ES-balear`, `da-DK`, `da`, `de-DE-x-simple-language`, `el-GR`, `el`, `eo`, `fa`, `ga-IE`, `ga`, `gl-ES`, `gl`, `it`, `ja-JP`, `ja`, `km-KH`, `km`, `ko-KR`, `ko`, `pl-PL`, `pl`, `ro-RO`, `ro`, `ru-RU`, `ru`, `sk-SK`, `sk`, `sl-SI`, `sl`, `sv`, `ta-IN`, `ta`, `tl-PH`, `tl`, `tr`, `uk-UA`, `uk`, `zh-CN`, `zh`, `zh-TW`, `crh-UA`, `crh`, `cs-CZ`, `cs`, `nb`, `no`, `nl-NL`, `de-DE-x-simple-language-DE`, `es-ES`, `it-IT`, `fa-IR`, `sv-SE`, `de-LU`, `fr-FR`, `bg-BG`, `bg`, `he-IL`, `he`, `hi-IN`, `hi`, `vi-VN`, `vi`, `th-TH`, `th`, `bn-BD`, `bn`

  Defaults to `"en-US"`.
</ResponseField>

<ResponseField name="tone_instructions" type="string">
  Set the tone of reviews and chat. Example: 'You must talk like Mr. T. I pity the fool who doesn't!'

  Defaults to `""`.

  <Info>
    Max length: 250
  </Info>
</ResponseField>

<ResponseField name="early_access" type="boolean">
  Enable early-access features.

  Defaults to `false`.
</ResponseField>

<ResponseField name="enable_free_tier" type="boolean">
  Enable free tier features for users not on a paid plan.

  Defaults to `true`.
</ResponseField>

<ResponseField name="inheritance" type="boolean">
  **Inheritance**: Use parent settings for any values not defined here. Inheritance only propagates upward if enabled at each level.

  Defaults to `false`.
</ResponseField>

## Reviews

Settings related to reviews.

<span id="param-profile" />

<ResponseField name="reviews.profile" type="enum">
  Set the review profile: quiet for only the most important feedback, chill for balanced feedback, assertive for more feedback (which may feel nitpicky).

  One of the following: `quiet`, `chill`, `assertive`

  <ul>
    <li>`quiet`: Posts only the most important comments inline and groups the other review comments in the review summary.</li>
    <li>`chill`: Balanced feedback.</li>
    <li>`assertive`: More feedback, which may feel nitpicky.</li>
  </ul>

  Defaults to `"chill"`.
</ResponseField>

<span id="param-request-changes-workflow" />

<ResponseField name="reviews.request_changes_workflow" type="boolean">
  Automatically approve when CodeRabbit’s comments are resolved, the latest commit has been reviewed, and no pre-merge checks are failing. Note: In GitLab, all discussions must be resolved.

  Defaults to `false`.
</ResponseField>

<span id="param-allow-author-approval" />

<ResponseField name="reviews.allow_author_approval" type="boolean">
  **Allow Author Approval**: Controls whether pull request authors can use `@coderabbitai approve` and `@coderabbitai resolve` on their own pull requests. When disabled, anyone other than the author can still use them, provided CodeRabbit can identify both the commenter and the author. The pull request’s branch configuration cannot re-enable this setting.

  Defaults to `true`.
</ResponseField>

<span id="param-high-level-summary" />

<ResponseField name="reviews.high_level_summary" type="boolean">
  Generate a high-level summary of the changes in the PR description or walkthrough.

  Defaults to `true`.
</ResponseField>

<span id="param-high-level-summary-instructions" />

<ResponseField name="reviews.high_level_summary_instructions" type="string">
  By default, CodeRabbit generates release notes in the description. Use this to customize the summary content and format. Example: 'Create concise release notes as a bullet-point list, followed by a Markdown table showing lines added and removed by each contributing author.' Note: Use `high_level_summary_in_walkthrough` to place the summary in the walkthrough instead of the description.

  Defaults to `""`.
</ResponseField>

<span id="param-high-level-summary-placeholder" />

<ResponseField name="reviews.high_level_summary_placeholder" type="string">
  Placeholder in the PR description that CodeRabbit replaces with the high-level summary. If `high_level_summary` is false, the summary is still generated when this placeholder is present.

  Defaults to `"@coderabbitai summary"`.
</ResponseField>

<span id="param-high-level-summary-in-walkthrough" />

<ResponseField name="reviews.high_level_summary_in_walkthrough" type="boolean">
  Include the high-level summary in the walkthrough comment.

  Defaults to `false`.
</ResponseField>

<span id="param-auto-title-placeholder" />

<ResponseField name="reviews.auto_title_placeholder" type="string">
  Add this keyword to the PR title to auto-generate a title.

  Defaults to `"@coderabbitai"`.
</ResponseField>

<span id="param-auto-title-instructions" />

<ResponseField name="reviews.auto_title_instructions" type="string">
  **Auto Title Instructions**: Customize how CodeRabbit generates the PR title.

  Defaults to `""`.
</ResponseField>

<span id="param-review-status" />

<ResponseField name="reviews.review_status" type="boolean">
  Post review status messages (e.g., when a review is skipped) in the walkthrough summary comment.

  Defaults to `true`.
</ResponseField>

<span id="param-review-details" />

<ResponseField name="reviews.review_details" type="boolean">
  Post review details (ignored files, extra context used, suppressed comments, etc.).

  Defaults to `false`.
</ResponseField>

<span id="param-review-progress" />

<ResponseField name="reviews.review_progress" type="boolean">
  Publish the canonical user-facing review status and progress updates (GitHub progress reports/check runs today; other platform equivalents may follow).

  Defaults to `true`.
</ResponseField>

<span id="param-commit-status" />

<ResponseField name="reviews.commit_status" type="boolean">
  Mirror review progress using legacy commit statuses for compatibility with required checks and existing automations. This setting is only used when review\_progress is disabled.

  Defaults to `true`.
</ResponseField>

<span id="param-fail-commit-status" />

<ResponseField name="reviews.fail_commit_status" type="boolean">
  On review errors, fail the active outward review status surface. When review\_progress is enabled this applies to progress reporting; otherwise it applies to the legacy commit-status mirror when enabled.

  Defaults to `false`.
</ResponseField>

<span id="param-collapse-walkthrough" />

<ResponseField name="reviews.collapse_walkthrough" type="boolean">
  Wrap the walkthrough in a Markdown collapsible section.

  Defaults to `true`.
</ResponseField>

<span id="param-changed-files-summary" />

<ResponseField name="reviews.changed_files_summary" type="boolean">
  Include a summary of the changed files in the walkthrough.

  Defaults to `true`.
</ResponseField>

<span id="param-sequence-diagrams" />

<ResponseField name="reviews.sequence_diagrams" type="boolean">
  Include sequence diagrams in the walkthrough.

  Defaults to `true`.
</ResponseField>

<span id="param-estimate-code-review-effort" />

<ResponseField name="reviews.estimate_code_review_effort" type="boolean">
  Include an estimated code review effort in the walkthrough.

  Defaults to `true`.
</ResponseField>

<span id="param-assess-linked-issues" />

<ResponseField name="reviews.assess_linked_issues" type="boolean">
  Include an assessment of how well the changes address linked issues in the walkthrough.

  Defaults to `true`.
</ResponseField>

<span id="param-related-issues" />

<ResponseField name="reviews.related_issues" type="boolean">
  Include potentially related issues in the walkthrough.

  Defaults to `true`.
</ResponseField>

<span id="param-related-prs" />

<ResponseField name="reviews.related_prs" type="boolean">
  **Related PRs**: Include potentially related PRs in the walkthrough.

  Defaults to `true`.
</ResponseField>

<span id="param-suggested-labels" />

<ResponseField name="reviews.suggested_labels" type="boolean">
  Suggest labels based on the changes, and include them in the walkthrough.

  Defaults to `true`.
</ResponseField>

<span id="param-labeling-instructions" />

<ResponseField name="reviews.labeling_instructions" type="array of object">
  **Labeling Instructions**: Define allowed labels and when to suggest them. When provided, CodeRabbit suggests only from this list (still informed by prior PRs); when empty, suggestions rely entirely on prior PRs.

  Defaults to `[]`.

  <Expandable title="Array items">
    <span id="param-label" />

    <ResponseField name="reviews.labeling_instructions[].label" type="string">
      Label to suggest for the PR. Example: frontend
    </ResponseField>

    <span id="param-instructions" />

    <ResponseField name="reviews.labeling_instructions[].instructions" type="string">
      Instructions for the label. Example: Apply when the PR contains changes to React components.

      <Info>
        Max length: 3000
      </Info>
    </ResponseField>
  </Expandable>

  ```yaml .coderabbit.yaml theme={null}
  reviews:
    labeling_instructions:
      - label: "frontend"
        instructions: "Apply when the PR contains changes to React components."
      - label: "coderabbit"
        instructions: "Apply if this PR contains changes to `.coderabbit.yaml`."
  ```
</ResponseField>

<span id="param-mutually-exclusive-groups" />

<ResponseField name="reviews.mutually_exclusive_groups" type="object">
  **Mutually Exclusive Groups**: Define labels that should not coexist. Example: `{ risk: ['critical', 'high', 'medium', 'low'] }`.
</ResponseField>

<span id="param-auto-apply-labels" />

<ResponseField name="reviews.auto_apply_labels" type="boolean">
  Automatically apply suggested labels to the PR.

  Defaults to `false`.
</ResponseField>

<span id="param-suggested-reviewers" />

<ResponseField name="reviews.suggested_reviewers" type="boolean">
  Suggest reviewers based on the changes, and include them in the walkthrough.

  Defaults to `true`.
</ResponseField>

<span id="param-auto-assign-reviewers" />

<ResponseField name="reviews.auto_assign_reviewers" type="boolean">
  Automatically assign the suggested reviewers to the PR.

  Defaults to `false`.
</ResponseField>

<span id="param-suggested-reviewers-instructions" />

<ResponseField name="reviews.suggested_reviewers_instructions" type="array of object">
  **Reviewer Instructions**: Map reviewers (users or team) to PR scenarios where they should be assigned. When empty, suggestions rely on prior PRs. Team handles are supported only on GitHub.

  Defaults to `[]`.

  <Expandable title="Array items">
    <span id="param-reviewers" />

    <ResponseField name="reviews.suggested_reviewers_instructions[].reviewers" type="array of object">
      List of reviewers to assign when the PR matches the instructions below. Each entry pairs a handle (username or team slug) with its type (user or group).

      <Expandable title="Array items">
        <span id="param-handle" />

        <ResponseField name="reviews.suggested_reviewers_instructions[].reviewers[].handle" type="string">
          Reviewer username or team slug to assign. Example: security-pdl

          <Info>
            Min length: 1
          </Info>
        </ResponseField>

        <span id="param-type" />

        <ResponseField name="reviews.suggested_reviewers_instructions[].reviewers[].type" type="enum">
          Whether the reviewer is an individual user or a team/group.

          One of the following: `user`, `group`

          Defaults to `"user"`.
        </ResponseField>
      </Expandable>
    </ResponseField>

    <ResponseField name="reviews.suggested_reviewers_instructions[].instructions" type="string">
      Instructions for when to assign these reviewers. Example: Assign when the PR contains Windows registry changes.

      <Info>
        Min length: 1, Max length: 3000
      </Info>
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-in-progress-fortune" />

<ResponseField name="reviews.in_progress_fortune" type="boolean">
  Post a fortune message while the review is running.

  Defaults to `true`.
</ResponseField>

<span id="param-poem" />

<ResponseField name="reviews.poem" type="boolean">
  Generate a poem in the walkthrough comment.

  Defaults to `false`.
</ResponseField>

<span id="param-enable-prompt-for-ai-agents" />

<ResponseField name="reviews.enable_prompt_for_ai_agents" type="boolean">
  **Prompt for AI Agents**: Include the '🤖 Prompt for AI Agents' section in inline review comments to provide codegen instructions for AI agents.

  Defaults to `true`.
</ResponseField>

<span id="param-path-filters" />

<ResponseField name="reviews.path_filters" type="array of string">
  Specify file patterns to include or exclude in a review using glob patterns (e.g., `!dist/**`, `src/**`). These patterns also apply to 'git sparse-checkout', including specified patterns and ignoring excluded ones (starting with '!') when cloning the repository.

  Defaults to `[]`.

  Learn more: [Path-based review instructions](/configuration/path-instructions#path-filters)

  ```yaml .coderabbit.yaml theme={null}
  reviews:
    path_filters:
      - "src/**"
      - "!src/generated/**"
  ```
</ResponseField>

<span id="param-path-instructions" />

<ResponseField name="reviews.path_instructions" type="array of object">
  **Path Instructions**: Add path-specific guidance for code review.

  Defaults to `[]`.

  Learn more: [Path-based review instructions](/configuration/path-instructions#path-instructions)

  <Expandable title="Array items">
    <span id="param-path" />

    <ResponseField name="reviews.path_instructions[].path" type="string">
      File path glob pattern. Example: `**/*.js`.
    </ResponseField>

    <ResponseField name="reviews.path_instructions[].instructions" type="string">
      Additional review guidance for matching paths.

      <Info>
        Max length: 20000
      </Info>
    </ResponseField>
  </Expandable>

  ```yaml .coderabbit.yaml theme={null}
  reviews:
    path_instructions:
      - path: "src/controllers/**"
        instructions: |
          - Focus on authentication, authorization, and input validation.
          - Flag any direct database queries that bypass the ORM layer.
      - path: "tests/**"
        instructions: |
          Ensure descriptive test names are used and that edge cases and error paths are covered.
  ```
</ResponseField>

<span id="param-abort-on-close" />

<ResponseField name="reviews.abort_on_close" type="boolean">
  Abort the in-progress review if the PR is closed or merged.

  Defaults to `true`.
</ResponseField>

<span id="param-disable-cache" />

<ResponseField name="reviews.disable_cache" type="boolean">
  Disable caching of code and dependencies; fetch them fresh on each run.

  Defaults to `false`.
</ResponseField>

<span id="param-post-merge-actions" />

<ResponseField name="reviews.post_merge_actions" type="array of object">
  **Custom Post-merge Actions**: Define custom actions to run after merging. Each action needs a unique name (≤100 chars) and a deterministic prompt (≤10,000 chars).

  Defaults to `[]`.

  <Expandable title="Array items">
    <ResponseField name="reviews.post_merge_actions[].enabled" type="boolean">
      **Enabled**: Run this action after a PR is merged.

      Defaults to `true`.
    </ResponseField>

    <ResponseField name="reviews.post_merge_actions[].name" type="string">
      **Name**: Display name (max 100 characters).

      Defaults to `""`.

      <Info>
        Min length: 1, Max length: 100
      </Info>
    </ResponseField>

    <span id="param-prompt" />

    <ResponseField name="reviews.post_merge_actions[].prompt" type="string">
      **Prompt**: Deterministic instructions describing the action to perform (max 10,000 characters).

      Defaults to `""`.

      <Info>
        Min length: 1, Max length: 10000
      </Info>
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-slop-detection" />

<h3 id="param-reviews-slop-detection">
  Anti-Slop
</h3>

`reviews.slop_detection`

Settings for detecting and managing spam or low-quality PRs on GitHub. Available for public repositories on all plans and private repositories on the Essentials plan and above.

<span id="param-enabled" />

<ResponseField name="reviews.slop_detection.enabled" type="boolean">
  Enable or disable slop and low-quality PR detection.

  Defaults to `true`.
</ResponseField>

<span id="param-include-all-authors" />

<ResponseField name="reviews.slop_detection.include_all_authors" type="boolean">
  Run slop detection for all PR authors, including collaborators, contributors, organization members, and repository owners.

  Defaults to `false`.
</ResponseField>

<ResponseField name="reviews.slop_detection.label" type="string">
  Label to apply to the PR when it is classified as slop. Example: slop

  <Info>
    Min length: 1
  </Info>
</ResponseField>

<span id="param-auto-review" />

<h3 id="param-reviews-auto-review">
  Auto review
</h3>

`reviews.auto_review`

Learn more: [Automatic review controls](/configuration/auto-review)

<ResponseField name="reviews.auto_review.enabled" type="boolean">
  **Automatic Review**: Review PRs automatically.

  Defaults to `true`.
</ResponseField>

<span id="param-description-keyword" />

<ResponseField name="reviews.auto_review.description_keyword" type="string">
  Keyword in the PR description that triggers a review when automatic reviews are disabled. If `enabled` is false and this field is not empty, CodeRabbit reviews the PR only when this keyword is present in the description.

  Defaults to `""`.
</ResponseField>

<span id="param-auto-incremental-review" />

<ResponseField name="reviews.auto_review.auto_incremental_review" type="boolean">
  **Incremental Review**: Re-run the review on each push.

  Defaults to `true`.
</ResponseField>

<span id="param-auto-pause-after-reviewed-commits" />

<ResponseField name="reviews.auto_review.auto_pause_after_reviewed_commits" type="integer">
  **Auto Pause After Reviewed Commits**: Pause automatic reviews after this many reviewed commits since the last pause. Set to 0 to disable.

  Defaults to `5`.

  <Info>
    Min: 0, Max: 9007199254740991
  </Info>
</ResponseField>

<span id="param-ignore-title-keywords" />

<ResponseField name="reviews.auto_review.ignore_title_keywords" type="array of string">
  Skip reviews when the PR title contains any of these keywords (case-insensitive).

  Defaults to `[]`.
</ResponseField>

<span id="param-labels" />

<ResponseField name="reviews.auto_review.labels" type="array of string">
  Labels that control which PRs are reviewed. Labels starting with '!' are negative matches. Examples: \['bug', 'feature'] reviews PRs with either label. \['!wip'] reviews all PRs except those labeled 'wip' when automatic reviews are enabled. \['bug', '!wip'] reviews PRs labeled 'bug' but not 'wip'. When `enabled` is false, a positive label match (for example \['review-ready']) triggers a review; negative-only labels such as \['!wip'] remain exclusion filters and do not opt PRs in by themselves.

  Defaults to `[]`.

  ```yaml .coderabbit.yaml theme={null}
  reviews:
    auto_review:
      enabled: false
      labels:
        - "review-ready"
  ```
</ResponseField>

<span id="param-drafts" />

<ResponseField name="reviews.auto_review.drafts" type="boolean">
  Include draft PRs.

  Defaults to `false`.
</ResponseField>

<span id="param-base-branches" />

<ResponseField name="reviews.auto_review.base_branches" type="array of string">
  Base branches (other than the default branch) to review. Accepts regex patterns. Use '.\*' to match all branches.

  Defaults to `[]`.

  Each entry is a regular expression tested against the target branch name without anchoring, so `develop` also matches `develop-2`. Use `^` and `$` to match the whole name.

  ```yaml .coderabbit.yaml theme={null}
  reviews:
    auto_review:
      base_branches:
        - "^develop$"
        - "^release/.*$"
  ```
</ResponseField>

<span id="param-ignore-usernames" />

<ResponseField name="reviews.auto_review.ignore_usernames" type="array of string">
  Skip reviews for PRs authored by these usernames (exact match; not email addresses).

  Defaults to `[]`.
</ResponseField>

<span id="param-finishing-touches" />

<h3 id="param-reviews-finishing-touches">
  Finishing touches
</h3>

`reviews.finishing_touches`

Learn more: [Finishing Touches overview](/finishing-touches)

<span id="param-docstrings" />

<ResponseField name="reviews.finishing_touches.docstrings" type="object">
  **Docstrings**: Configure docstring generation.

  <Expandable title="Docstrings">
    <ResponseField name="reviews.finishing_touches.docstrings.enabled" type="boolean">
      **Docstrings**: Enable the docstrings finishing touch (trigger via the 📝 Generate docstrings checkbox or `@coderabbitai generate docstrings`). CodeRabbit generates or improves docstrings for functions changed in the PR and opens a follow-up PR containing the docstring edits.

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-unit-tests" />

<ResponseField name="reviews.finishing_touches.unit_tests" type="object">
  **Unit Tests**: Configure unit test generation.

  <Expandable title="Unit Tests">
    <ResponseField name="reviews.finishing_touches.unit_tests.enabled" type="boolean">
      **Unit Tests**: Generate unit tests for changes in PRs.

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-simplify" />

<ResponseField name="reviews.finishing_touches.simplify" type="object">
  **Simplify**: Configure code simplification.

  <Expandable title="Simplify">
    <ResponseField name="reviews.finishing_touches.simplify.enabled" type="boolean">
      **Simplify**: Enable the simplify finishing touch (trigger via the ✨ Simplify code checkbox). CodeRabbit reviews changed code for reuse, quality, and efficiency, then applies targeted improvements.

      Defaults to `false`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-autofix" />

<ResponseField name="reviews.finishing_touches.autofix" type="object">
  **Autofix**: Configure autofix behavior.

  <Expandable title="Autofix">
    <ResponseField name="reviews.finishing_touches.autofix.enabled" type="boolean">
      **Autofix**: Enable the autofix finishing touch (trigger via the 🪄 Autofix checkboxes under review comments or the `@coderabbitai autofix` command). When disabled, the autofix checkboxes are hidden, the command is removed from help, and CodeRabbit declines `@coderabbitai autofix` requests.

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-fix-ci" />

<ResponseField name="reviews.finishing_touches.fix_ci" type="object">
  **Fix Failing CI**: Configure the CI fixer.

  <Expandable title="Fix Failing CI">
    <ResponseField name="reviews.finishing_touches.fix_ci.enabled" type="boolean">
      **Fix Failing CI**: Enable the fix-ci finishing touch on GitHub and Azure DevOps; requires a Team plan. When CI failures are attributed to the current pull request, Finishing Touches offers the delivery modes supported by the repository. Where both modes are available, it offers mutually exclusive stacked-pull-request and direct-commit options; where stacked-pull-request delivery is unavailable but direct commits are supported, it offers direct commit only. The `@coderabbitai fix-ci` command requests a stacked pull request by default, but commits in place on a CodeRabbit-authored pull request to avoid creating another stacked pull request. Use `@coderabbitai fix-ci commit` to request a direct commit. When disabled, both commands are removed from help and CodeRabbit declines fix-ci requests.

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-resolve-merge-conflict" />

<ResponseField name="reviews.finishing_touches.resolve_merge_conflict" type="object">
  **Resolve Merge Conflicts**: Configure the merge-conflict resolver.

  <Expandable title="Resolve Merge Conflicts">
    <ResponseField name="reviews.finishing_touches.resolve_merge_conflict.enabled" type="boolean">
      **Resolve Merge Conflicts**: Enable the merge-conflict resolver (trigger via `@coderabbitai resolve merge conflict`). CodeRabbit analyzes the intent behind both sides of a conflict and commits a resolution to your branch. When disabled, the command is removed from help and CodeRabbit declines resolution requests. Available on GitHub and GitLab; requires a Team plan.

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-custom" />

<ResponseField name="reviews.finishing_touches.custom" type="array of object">
  **Custom Recipes**: Define custom finishing touch recipes up to your plan limit. Trigger a recipe with `@coderabbitai run <recipe name>`.

  Defaults to `[]`.

  <Expandable title="Array items">
    <ResponseField name="reviews.finishing_touches.custom[].enabled" type="boolean">
      **Enabled**: Enable this custom finishing touch recipe.

      Defaults to `true`.
    </ResponseField>

    <span id="param-name" />

    <ResponseField name="reviews.finishing_touches.custom[].name" type="string">
      **Name**: Recipe name used in commands (for example: `@coderabbitai run cleanup stale imports`). Run with `@coderabbitai run <recipe name>`.

      Defaults to `""`.

      <Info>
        Min length: 1, Max length: 100
      </Info>
    </ResponseField>

    <ResponseField name="reviews.finishing_touches.custom[].instructions" type="string">
      **Instructions**: Describe what this recipe should do. Trigger with `@coderabbitai run <recipe name>` or the checkbox under "✨ Finishing Touches". CodeRabbit provides PR context and runs this with an agent.

      Defaults to `""`.

      <Info>
        Min length: 1, Max length: 10000
      </Info>
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-pre-merge-checks" />

<h3 id="param-reviews-pre-merge-checks">
  Pre-Merge Checks
</h3>

`reviews.pre_merge_checks`

Learn more: [Built-in Pre-Merge Checks](/pr-reviews/pre-merge-checks)

<span id="param-override-requested-reviewers-only" />

<ResponseField name="reviews.pre_merge_checks.override_requested_reviewers_only" type="boolean">
  **Override Requested Reviewers Only**: When enabled, the pull request author cannot override/ignore failing pre-merge checks. Eligible actors are individually requested reviewers and, on GitHub, members of requested reviewer teams or submitted reviewers whose author association is OWNER, MEMBER, or COLLABORATOR.

  Defaults to `false`.
</ResponseField>

<ResponseField name="reviews.pre_merge_checks.docstrings" type="object">
  **Docstring Coverage**: Check that docstring coverage meets the configured threshold.

  <Expandable title="Docstring Coverage">
    <span id="param-mode" />

    <ResponseField name="reviews.pre_merge_checks.docstrings.mode" type="enum">
      **Mode**: Enforcement level: `off` disables the check, `warning` posts a warning, and `error` requires resolution before merging. If the request-changes workflow is enabled, `error` can block the PR until the check passes.

      One of the following: `off`, `warning`, `error`

      Defaults to `"warning"`.
    </ResponseField>

    <span id="param-threshold" />

    <ResponseField name="reviews.pre_merge_checks.docstrings.threshold" type="number">
      **Threshold**: Minimum docstring coverage (%) required to pass.

      Defaults to `80`.

      <Info>
        Min: 0, Max: 100
      </Info>
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-title" />

<ResponseField name="reviews.pre_merge_checks.title" type="object">
  **Title Check**: Validate the PR title against the requirements.

  <Expandable title="Title Check">
    <ResponseField name="reviews.pre_merge_checks.title.mode" type="enum">
      **Mode**: Enforcement level: `off` disables the check, `warning` posts a warning, and `error` requires resolution before merging. If the request-changes workflow is enabled, `error` can block the PR until the check passes.

      One of the following: `off`, `warning`, `error`

      Defaults to `"warning"`.
    </ResponseField>

    <span id="param-requirements" />

    <ResponseField name="reviews.pre_merge_checks.title.requirements" type="string">
      **Requirements**: Describe title requirements. Example: 'Title should be concise and descriptive, ideally under 50 characters.'

      Defaults to `""`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-description" />

<ResponseField name="reviews.pre_merge_checks.description" type="object">
  **Description Check**: Check that the PR description follows best practices.

  <Expandable title="Description Check">
    <ResponseField name="reviews.pre_merge_checks.description.mode" type="enum">
      **Mode**: Enforcement level: `off` disables the check, `warning` posts a warning, and `error` requires resolution before merging. If the request-changes workflow is enabled, `error` can block the PR until the check passes.

      One of the following: `off`, `warning`, `error`

      Defaults to `"warning"`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-issue-assessment" />

<ResponseField name="reviews.pre_merge_checks.issue_assessment" type="object">
  **Linked Issue Assessment**: Assess how well the PR addresses linked issues.

  <Expandable title="Linked Issue Assessment">
    <ResponseField name="reviews.pre_merge_checks.issue_assessment.mode" type="enum">
      **Mode**: Enforcement level: `off` disables the check, `warning` posts a warning, and `error` requires resolution before merging. If the request-changes workflow is enabled, `error` can block the PR until the check passes.

      One of the following: `off`, `warning`, `error`

      Defaults to `"warning"`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-custom-checks" />

<ResponseField name="reviews.pre_merge_checks.custom_checks" type="array of object">
  **Custom Pre-merge Checks**: Define custom checks that must pass before merging. Each check needs a unique name (≤50 chars) and deterministic instructions (≤10,000 chars).

  Defaults to `[]`.

  Learn more: [Custom checks](/pr-reviews/custom-checks)

  <Expandable title="Array items">
    <ResponseField name="reviews.pre_merge_checks.custom_checks[].mode" type="enum">
      **Mode**: Enforcement level: `off` disables the check, `warning` posts a warning, and `error` requires resolution before merging. If the request-changes workflow is enabled, `error` can block the PR until the check passes.

      One of the following: `off`, `warning`, `error`

      Defaults to `"warning"`.
    </ResponseField>

    <ResponseField name="reviews.pre_merge_checks.custom_checks[].name" type="string">
      **Name**: Display name (max 50 characters).

      Defaults to `""`.

      <Info>
        Min length: 1, Max length: 50
      </Info>
    </ResponseField>

    <ResponseField name="reviews.pre_merge_checks.custom_checks[].instructions" type="string">
      **Instructions**: Deterministic pass/fail criteria (max 10,000 characters).

      Defaults to `""`.

      <Info>
        Min length: 1, Max length: 10000
      </Info>
    </ResponseField>
  </Expandable>

  ```yaml .coderabbit.yaml theme={null}
  reviews:
    pre_merge_checks:
      custom_checks:
        - name: "Undocumented Breaking Changes"
          mode: "warning"
          instructions: |
            All breaking changes to public APIs, CLI flags, environment variables, or database schemas must be documented in the "Breaking Change" section of the PR description and in CHANGELOG.md.
  ```
</ResponseField>

<span id="param-tools" />

<h3 id="param-reviews-tools">
  Tools
</h3>

`reviews.tools`

Tools that provide additional context to code reviews.

<span id="param-ast-grep" />

<ResponseField name="reviews.tools.ast-grep" type="object">
  **Enable ast-grep**: ast-grep is a code analysis tool that helps you to find patterns in your codebase using abstract syntax trees patterns.

  Version: `v0.45.3`

  <Expandable title="Enable ast-grep">
    <ResponseField name="reviews.tools.ast-grep.enabled" type="boolean">
      **Enable ast-grep**

      Defaults to `true`.
    </ResponseField>

    <span id="param-rule-dirs" />

    <ResponseField name="reviews.tools.ast-grep.rule_dirs" type="array of string">
      List of rules directories.

      Defaults to `[]`.
    </ResponseField>

    <span id="param-util-dirs" />

    <ResponseField name="reviews.tools.ast-grep.util_dirs" type="array of string">
      List of utils directories.

      Defaults to `[]`.
    </ResponseField>

    <span id="param-essential-rules" />

    <ResponseField name="reviews.tools.ast-grep.essential_rules" type="boolean">
      Use ast-grep essentials package.

      Defaults to `true`.
    </ResponseField>

    <span id="param-packages" />

    <ResponseField name="reviews.tools.ast-grep.packages" type="array of string">
      Predefined packages to be used.

      Defaults to `[]`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-shellcheck" />

<ResponseField name="reviews.tools.shellcheck" type="object">
  ShellCheck is a static analysis tool that finds bugs in your shell scripts.

  Version: `v0.11.0`

  <Expandable title="Shellcheck">
    <ResponseField name="reviews.tools.shellcheck.enabled" type="boolean">
      **Enable ShellCheck**: ShellCheck is a static analysis tool that finds bugs in your shell.

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-ruff" />

<ResponseField name="reviews.tools.ruff" type="object">
  Ruff is a Python linter and code formatter.

  Version: `v0.16.7`

  <Expandable title="Ruff">
    <ResponseField name="reviews.tools.ruff.enabled" type="boolean">
      **Enable Ruff**

      Defaults to `true`.
    </ResponseField>

    <span id="param-config-file" />

    <ResponseField name="reviews.tools.ruff.config_file" type="string">
      Optional path to a Ruff configuration file relative to the repository. When set, this configuration is used for every reviewed file instead of Ruff's closest-config discovery.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-markdownlint" />

<ResponseField name="reviews.tools.markdownlint" type="object">
  markdownlint-cli2 is a static analysis tool to enforce standards and consistency for Markdown files.

  Version: `v0.23.2`

  <Expandable title="Markdownlint">
    <ResponseField name="reviews.tools.markdownlint.enabled" type="boolean">
      **Enable markdownlint**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-github-checks" />

<ResponseField name="reviews.tools.github-checks" type="object">
  GitHub Checks integration configuration.

  <Expandable title="Github-checks">
    <ResponseField name="reviews.tools.github-checks.enabled" type="boolean">
      **Enable GitHub Checks**: Enable integration, defaults to true

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-languagetool" />

<ResponseField name="reviews.tools.languagetool" type="object">
  LanguageTool is a style and grammar checker for 30+ languages.

  <Expandable title="Languagetool">
    <ResponseField name="reviews.tools.languagetool.enabled" type="boolean">
      **Enable LanguageTool**: Enable LanguageTool integration.

      Defaults to `true`.
    </ResponseField>

    <span id="param-enabled-rules" />

    <ResponseField name="reviews.tools.languagetool.enabled_rules" type="array of string">
      IDs of rules to be enabled. The rule won't run unless 'level' is set to a level that activates the rule.

      Defaults to `[]`.
    </ResponseField>

    <span id="param-disabled-rules" />

    <ResponseField name="reviews.tools.languagetool.disabled_rules" type="array of string">
      IDs of rules to be disabled. Note: EN\_UNPAIRED\_BRACKETS, and EN\_UNPAIRED\_QUOTES are always disabled.

      Defaults to `[]`.
    </ResponseField>

    <span id="param-enabled-categories" />

    <ResponseField name="reviews.tools.languagetool.enabled_categories" type="array of string">
      IDs of categories to be enabled.

      Defaults to `[]`.
    </ResponseField>

    <span id="param-disabled-categories" />

    <ResponseField name="reviews.tools.languagetool.disabled_categories" type="array of string">
      IDs of categories to be disabled. Note: TYPOS, TYPOGRAPHY, and CASING are always disabled.

      Defaults to `[]`.
    </ResponseField>

    <span id="param-enabled-only" />

    <ResponseField name="reviews.tools.languagetool.enabled_only" type="boolean">
      Run only the rules and categories listed in `enabled_rules` or `enabled_categories`, instead of the default set.

      Defaults to `false`.

      With `enabled_only: true`, at least one rule or category is required. If both lists are empty, CodeRabbit skips LanguageTool and reports an error.
    </ResponseField>

    <span id="param-level" />

    <ResponseField name="reviews.tools.languagetool.level" type="enum">
      If set to 'picky', additional rules will be activated, i.e. rules that you might only find useful when checking formal text.

      One of the following: `default`, `picky`

      Defaults to `"default"`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-biome" />

<ResponseField name="reviews.tools.biome" type="object">
  Biome is a fast formatter, linter, and analyzer for web projects.

  Version: `v2.5.13`

  <Expandable title="Biome">
    <ResponseField name="reviews.tools.biome.enabled" type="boolean">
      **Enable Biome**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-hadolint" />

<ResponseField name="reviews.tools.hadolint" type="object">
  Hadolint is a Dockerfile linter.

  Version: `v2.15.1`

  <Expandable title="Hadolint">
    <ResponseField name="reviews.tools.hadolint.enabled" type="boolean">
      **Enable Hadolint**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-swiftlint" />

<ResponseField name="reviews.tools.swiftlint" type="object">
  SwiftLint integration configuration object.

  Version: `v0.65.1`

  <Expandable title="Swiftlint">
    <ResponseField name="reviews.tools.swiftlint.enabled" type="boolean">
      **Enable SwiftLint**: SwiftLint is a Swift linter.

      Defaults to `true`.
    </ResponseField>

    <ResponseField name="reviews.tools.swiftlint.config_file" type="string">
      Optional path to the SwiftLint configuration file relative to the repository. This is useful when the configuration file is named differently than the default '.swiftlint.yml' or '.swiftlint.yaml'.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-phpstan" />

<ResponseField name="reviews.tools.phpstan" type="object">
  PHPStan is a tool to analyze PHP code.

  Version: `v2.2.14`

  <Expandable title="Phpstan">
    <ResponseField name="reviews.tools.phpstan.enabled" type="boolean">
      **Enable PHPStan**: PHPStan requires [config file](https://phpstan.org/config-reference#config-file) in your repository root. Please ensure that this file contains the `paths:` parameter.

      Defaults to `true`.
    </ResponseField>

    <ResponseField name="reviews.tools.phpstan.level" type="enum">
      **Level**: Specify the [rule level](https://phpstan.org/user-guide/rule-levels) to run. When set to `default`, the level is determined by the review profile: `chill` uses level 3 (real bugs only — return/property type mismatches, array offset errors) and `assertive` uses level 8 (adds dead code detection, argument type checking, null safety, and typehint checks). This setting is ignored if your configuration file already has a `level:` parameter.

      One of the following: `0`, `1`, `2`, `3`, `4`, `5`, `6`, `7`, `8`, `9`, `default`, `max`

      Defaults to `"default"`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-phpmd" />

<ResponseField name="reviews.tools.phpmd" type="object">
  PHPMD is a tool to find potential problems in PHP code.

  Version: `v2.15.0`

  <Expandable title="Phpmd">
    <ResponseField name="reviews.tools.phpmd.enabled" type="boolean">
      **Enable PHPMD**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-phpcs" />

<ResponseField name="reviews.tools.phpcs" type="object">
  PHP CodeSniffer is a PHP linter and coding standard checker.

  Version: `v3.13.6`

  <Expandable title="Phpcs">
    <ResponseField name="reviews.tools.phpcs.enabled" type="boolean">
      **Enable PHP CodeSniffer**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-golangci-lint" />

<ResponseField name="reviews.tools.golangci-lint" type="object">
  golangci-lint is a fast linters runner for Go.

  Version: `v2.13.2`

  <Expandable title="Golangci-lint">
    <ResponseField name="reviews.tools.golangci-lint.enabled" type="boolean">
      **Enable golangci-lint**

      Defaults to `true`.
    </ResponseField>

    <ResponseField name="reviews.tools.golangci-lint.config_file" type="string">
      Optional path to the golangci-lint configuration file relative to the repository. Useful when the configuration file is named differently than the default '.golangci.yml', '.golangci.yaml', '.golangci.toml', '.golangci.json'.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-yamllint" />

<ResponseField name="reviews.tools.yamllint" type="object">
  YAMLlint is a linter for YAML files.

  Version: `v1.37.1`

  <Expandable title="Yamllint">
    <ResponseField name="reviews.tools.yamllint.enabled" type="boolean">
      **Enable YAMLlint**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-gitleaks" />

<ResponseField name="reviews.tools.gitleaks" type="object">
  Betterleaks is a secret scanner (an improved version of Gitleaks).

  Version: `v1.8.1`

  <Expandable title="Gitleaks">
    <ResponseField name="reviews.tools.gitleaks.enabled" type="boolean">
      **Enable Betterleaks**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-trufflehog" />

<ResponseField name="reviews.tools.trufflehog" type="object">
  TruffleHog is a secret scanner with verification capabilities that can detect and verify secrets in code.

  Version: `v3.96.0`

  <Expandable title="Trufflehog">
    <ResponseField name="reviews.tools.trufflehog.enabled" type="boolean">
      **Enable TruffleHog**: TruffleHog is a secret scanner with verification capabilities.

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-checkov" />

<ResponseField name="reviews.tools.checkov" type="object">
  Checkov is a static code analysis tool for infrastructure-as-code files.

  Version: `v3.3.17`

  <Expandable title="Checkov">
    <ResponseField name="reviews.tools.checkov.enabled" type="boolean">
      **Enable Checkov**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-tflint" />

<ResponseField name="reviews.tools.tflint" type="object">
  TFLint is a Terraform linter for finding potential errors and enforcing best practices.

  Version: `v0.64.0`

  <Expandable title="Tflint">
    <ResponseField name="reviews.tools.tflint.enabled" type="boolean">
      **Enable TFLint**: TFLint is a Terraform linter for finding potential errors.

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-detekt" />

<ResponseField name="reviews.tools.detekt" type="object">
  Detekt is a static code analysis tool for Kotlin files.

  Version: `v1.23.8`

  <Expandable title="Detekt">
    <ResponseField name="reviews.tools.detekt.enabled" type="boolean">
      **Enable detekt**: detekt is a static code analysis tool for Kotlin files.

      Defaults to `true`.
    </ResponseField>

    <ResponseField name="reviews.tools.detekt.config_file" type="string">
      Optional path to the detekt configuration file relative to the repository.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-eslint" />

<ResponseField name="reviews.tools.eslint" type="object">
  ESLint is a static code analysis tool for JavaScript files.

  <Expandable title="Eslint">
    <ResponseField name="reviews.tools.eslint.enabled" type="boolean">
      **Enable ESLint**

      Defaults to `true`.
    </ResponseField>

    <ResponseField name="reviews.tools.eslint.config_file" type="string">
      Optional path to an ESLint configuration file relative to the repository. When set, this configuration is used for every file instead of discovering ESLint configurations recursively.
    </ResponseField>

    <span id="param-e18e" />

    <ResponseField name="reviews.tools.eslint.e18e" type="object">
      @e18e/eslint-plugin modernization, performance, and dependency replacement checks.

      <Expandable title="E18e">
        <ResponseField name="reviews.tools.eslint.e18e.enabled" type="boolean">
          **Enable @e18e/eslint-plugin**: Detects dependencies with modern replacements, flags unmaintained packages, and suggests native API alternatives or lighter replacements

          Version: `v0.8.0`

          Defaults to `true`.
        </ResponseField>
      </Expandable>
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-flake8" />

<ResponseField name="reviews.tools.flake8" type="object">
  Flake8 is a Python linter that wraps PyFlakes, pycodestyle and Ned Batchelder's McCabe script.

  Version: `v7.3.0`

  <Expandable title="Flake8">
    <ResponseField name="reviews.tools.flake8.enabled" type="boolean">
      **Enable Flake8**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-fbinfer" />

<ResponseField name="reviews.tools.fbinfer" type="object">
  Configuration for Infer to find bugs in Java and C/C++ code

  Version: `v1.3.0`

  <Expandable title="Fbinfer">
    <ResponseField name="reviews.tools.fbinfer.enabled" type="boolean">
      Enable Infer for static bug analysis in Java and C/C++ code

      Defaults to `true`.
    </ResponseField>

    <span id="param-enable-java" />

    <ResponseField name="reviews.tools.fbinfer.enable_java" type="boolean">
      **Enable Java analysis**: Disabled by default because Java analysis may require compiling more than the changed files.

      Defaults to `false`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-fortitude-lint" />

<ResponseField name="reviews.tools.fortitudeLint" type="object">
  Fortitude is a Fortran linter that checks for code quality and style issues.

  Version: `v0.9.2`

  <Expandable title="Fortitude Lint">
    <ResponseField name="reviews.tools.fortitudeLint.enabled" type="boolean">
      **Enable Fortitude**: Fortitude is a Fortran linter that checks for code quality and style issues

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-rubocop" />

<ResponseField name="reviews.tools.rubocop" type="object">
  RuboCop is a Ruby static code analyzer (a.k.a. linter ) and code formatter.

  Version: `v1.91.0`

  <Expandable title="Rubocop">
    <ResponseField name="reviews.tools.rubocop.enabled" type="boolean">
      **Enable RuboCop**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-buf" />

<ResponseField name="reviews.tools.buf" type="object">
  Buf offers linting for Protobuf files.

  Version: `v1.73.0`

  <Expandable title="Buf">
    <ResponseField name="reviews.tools.buf.enabled" type="boolean">
      **Enable Buf**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-regal" />

<ResponseField name="reviews.tools.regal" type="object">
  Regal is a linter and language server for Rego.

  Version: `v0.42.0`

  <Expandable title="Regal">
    <ResponseField name="reviews.tools.regal.enabled" type="boolean">
      **Enable Regal**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-actionlint" />

<ResponseField name="reviews.tools.actionlint" type="object">
  actionlint is a static checker for GitHub Actions workflow files.

  Version: `v1.7.12`

  <Expandable title="Actionlint">
    <ResponseField name="reviews.tools.actionlint.enabled" type="boolean">
      **Enable actionlint**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-zizmor" />

<ResponseField name="reviews.tools.zizmor" type="object">
  zizmor is a static security analyzer for GitHub Actions workflow files.

  Version: `v1.30.1`

  <Expandable title="Zizmor">
    <ResponseField name="reviews.tools.zizmor.enabled" type="boolean">
      **Enable zizmor**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-pmd" />

<ResponseField name="reviews.tools.pmd" type="object">
  PMD is an extensible multilanguage static code analyzer. It’s mainly concerned with Java.

  Version: `v7.27.0`

  <Expandable title="Pmd">
    <ResponseField name="reviews.tools.pmd.enabled" type="boolean">
      **Enable PMD**

      Defaults to `true`.
    </ResponseField>

    <ResponseField name="reviews.tools.pmd.config_file" type="string">
      Optional path to the PMD configuration file relative to the repository.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-clang" />

<ResponseField name="reviews.tools.clang" type="object">
  Configuration for Clang to perform static analysis on C and C++ code

  Version: `v14.0.6`

  <Expandable title="Clang">
    <ResponseField name="reviews.tools.clang.enabled" type="boolean">
      Enable Clang for C/C++ static analysis and code quality checks

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-cppcheck" />

<ResponseField name="reviews.tools.cppcheck" type="object">
  Cppcheck is a static code analysis tool for the C and C++ programming languages.

  Version: `v2.21.0`

  <Expandable title="Cppcheck">
    <ResponseField name="reviews.tools.cppcheck.enabled" type="boolean">
      **Enable Cppcheck**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-vale" />

<ResponseField name="reviews.tools.vale" type="object">
  Vale lints prose using the repository's checked-in style rules.

  Version: `v3.21.0`

  <Expandable title="Vale">
    <ResponseField name="reviews.tools.vale.enabled" type="boolean">
      **Enable Vale**: Vale checks prose against repository-defined editorial style rules. It runs only when a supported root Vale configuration is present.

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-verilator" />

<ResponseField name="reviews.tools.verilator" type="object">
  Verilator statically analyzes Verilog and SystemVerilog source files.

  Version: `v5.052`

  <Expandable title="Verilator">
    <ResponseField name="reviews.tools.verilator.enabled" type="boolean">
      **Enable Verilator**: Verilator lints Verilog and SystemVerilog for syntax, width, connectivity, and behavioral correctness issues.

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-opengrep" />

<ResponseField name="reviews.tools.opengrep" type="object">
  OpenGrep is a high-performance static code analysis engine, compatible with Semgrep configurations.

  Version: `v1.30.0`

  <Expandable title="Opengrep">
    <ResponseField name="reviews.tools.opengrep.enabled" type="boolean">
      **Enable OpenGrep**: OpenGrep is a high-performance static code analysis engine for finding security vulnerabilities and bugs across 17+ languages.

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-semgrep" />

<ResponseField name="reviews.tools.semgrep" type="object">
  Semgrep is a static analysis tool designed to scan code for security vulnerabilities and code quality issues.

  Version: `v1.177.0`

  <Expandable title="Semgrep">
    <ResponseField name="reviews.tools.semgrep.enabled" type="boolean">
      **Enable Semgrep**

      Defaults to `true`.
    </ResponseField>

    <ResponseField name="reviews.tools.semgrep.config_file" type="string">
      Optional path to the Semgrep configuration file relative to the repository.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-circleci" />

<ResponseField name="reviews.tools.circleci" type="object">
  CircleCI tool is a static checker for CircleCI config files.

  Version: `v1.0.50462`

  <Expandable title="Circleci">
    <ResponseField name="reviews.tools.circleci.enabled" type="boolean">
      **Enable CircleCI**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-clippy" />

<ResponseField name="reviews.tools.clippy" type="object">
  Clippy is a collection of lints to catch common mistakes and improve your Rust code.

  <Expandable title="Clippy">
    <ResponseField name="reviews.tools.clippy.enabled" type="boolean">
      **Enable Clippy**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-sqlfluff" />

<ResponseField name="reviews.tools.sqlfluff" type="object">
  SQLFluff is an open source, dialect-flexible and configurable SQL linter.

  Version: `v4.3.0`

  <Expandable title="Sqlfluff">
    <ResponseField name="reviews.tools.sqlfluff.enabled" type="boolean">
      **Enable SQLFluff**

      Defaults to `true`.
    </ResponseField>

    <ResponseField name="reviews.tools.sqlfluff.config_file" type="string">
      Optional path to the SQLFluff configuration file relative to the repository. Use this when the config file is not named one of SQLFluff's default filenames.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-squawk" />

<ResponseField name="reviews.tools.squawk" type="object">
  Configuration for Squawk to lint Postgres migrations and SQL for safe schema changes

  Version: `v2.65.0`

  <Expandable title="Squawk">
    <ResponseField name="reviews.tools.squawk.enabled" type="boolean">
      **Enable Squawk for Postgres migration linting**: Detects unsafe schema changes that can cause downtime or blocking locks

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-trivy" />

<ResponseField name="reviews.tools.trivy" type="object">
  Trivy is a comprehensive security scanner that detects misconfigurations and secrets in Infrastructure as Code files

  Version: `v0.74.0`

  <Expandable title="Trivy">
    <ResponseField name="reviews.tools.trivy.enabled" type="boolean">
      Enable Trivy for security scanning of IaC files (Terraform, Kubernetes, Docker, etc.)

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-prisma-lint" />

<ResponseField name="reviews.tools.prismaLint" type="object">
  Configuration for Prisma Schema linting to ensure schema file quality

  Version: `v0.13.1`

  <Expandable title="Prisma Lint">
    <ResponseField name="reviews.tools.prismaLint.enabled" type="boolean">
      **Enable Prisma Schema linting**: Prisma Schema linting helps maintain consistent and error-free schema files

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-pylint" />

<ResponseField name="reviews.tools.pylint" type="object">
  Pylint is a Python static code analysis tool.

  Version: `v4.0.8`

  <Expandable title="Pylint">
    <ResponseField name="reviews.tools.pylint.enabled" type="boolean">
      **Enable Pylint**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-oxc" />

<ResponseField name="reviews.tools.oxc" type="object">
  Oxlint is a JavaScript/TypeScript linter for OXC written in Rust.

  Version: `v1.83.0`

  <Expandable title="Oxc">
    <ResponseField name="reviews.tools.oxc.enabled" type="boolean">
      **Enable Oxlint**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-shopify-theme-check" />

<ResponseField name="reviews.tools.shopifyThemeCheck" type="object">
  Configuration for Shopify Theme Check to ensure theme quality and best practices

  Version: `cli 4.8.0, theme 3.58.2`

  <Expandable title="Shopify Theme Check">
    <ResponseField name="reviews.tools.shopifyThemeCheck.enabled" type="boolean">
      **Enable Shopify Theme Check**: A linter for Shopify themes that helps you follow Shopify theme & Liquid best practices

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-luacheck" />

<ResponseField name="reviews.tools.luacheck" type="object">
  Configuration for Lua code linting to ensure code quality

  Version: `v1.2.0`

  <Expandable title="Luacheck">
    <ResponseField name="reviews.tools.luacheck.enabled" type="boolean">
      **Enable Lua code linting**: Luacheck helps maintain consistent and error-free Lua code

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-brakeman" />

<ResponseField name="reviews.tools.brakeman" type="object">
  Brakeman is a static analysis security vulnerability scanner for Ruby on Rails applications.

  Version: `v8.0.6`

  <Expandable title="Brakeman">
    <ResponseField name="reviews.tools.brakeman.enabled" type="boolean">
      **Enable Brakeman**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-dotenv-lint" />

<ResponseField name="reviews.tools.dotenvLint" type="object">
  dotenv-linter is a tool for checking and fixing .env files for problems and best practices

  Version: `v4.0.0`

  <Expandable title="Dotenv Lint">
    <ResponseField name="reviews.tools.dotenvLint.enabled" type="boolean">
      **Enable dotenv-linter**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-htmlhint" />

<ResponseField name="reviews.tools.htmlhint" type="object">
  HTMLHint is a static code analysis tool for HTML files.

  Version: `v1.9.2`

  <Expandable title="Htmlhint">
    <ResponseField name="reviews.tools.htmlhint.enabled" type="boolean">
      **Enable HTMLHint**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-stylelint" />

<ResponseField name="reviews.tools.stylelint" type="object">
  Stylelint is a linter for stylesheets (CSS, SCSS, Sass, Less, SugarSS, Stylus) that helps avoid errors and enforce conventions.

  Version: `v17.14.0`

  <Expandable title="Stylelint">
    <ResponseField name="reviews.tools.stylelint.enabled" type="boolean">
      **Enable Stylelint**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-checkmake" />

<ResponseField name="reviews.tools.checkmake" type="object">
  checkmake is a linter for Makefiles.

  Version: `v0.3.2`

  <Expandable title="Checkmake">
    <ResponseField name="reviews.tools.checkmake.enabled" type="boolean">
      **Enable checkmake**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-osv-scanner" />

<ResponseField name="reviews.tools.osvScanner" type="object">
  OSV Scanner is a tool for vulnerability package scanning.

  Version: `v2.6.0`

  <Expandable title="Osv Scanner">
    <ResponseField name="reviews.tools.osvScanner.enabled" type="boolean">
      **Enable OSV Scanner**: OSV Scanner is a tool for vulnerability package scanning

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-oasdiff" />

<ResponseField name="reviews.tools.oasdiff" type="object">
  oasdiff detects breaking changes between OpenAPI specifications.

  Version: `v1.32.1`

  <Expandable title="Oasdiff">
    <ResponseField name="reviews.tools.oasdiff.enabled" type="boolean">
      **Enable oasdiff**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-react-doctor" />

<ResponseField name="reviews.tools.reactDoctor" type="object">
  React Doctor scans React codebases for security, performance, correctness, and accessibility issues.

  Version: `v0.9.14`

  <Expandable title="React Doctor">
    <ResponseField name="reviews.tools.reactDoctor.enabled" type="boolean">
      **Enable React Doctor**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-presidio" />

<ResponseField name="reviews.tools.presidio" type="object">
  Microsoft Presidio Analyzer 2.2.364 detects sensitive identifiers (including payment cards, US SSN, cryptocurrency wallets, and phone numbers) in changed files. Tune entities, thresholds, and languages in repository Presidio configuration (for example .presidiocli or AnalyzerEngineProvider YAML); the built-in scan uses fixed defaults and is skipped when that configuration is present.

  Version: `v2.2.364`

  <Expandable title="Presidio">
    <ResponseField name="reviews.tools.presidio.enabled" type="boolean">
      Enable Microsoft Presidio Analyzer for high-signal PII in changed files

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-blinter" />

<ResponseField name="reviews.tools.blinter" type="object">
  Blinter is a linter for Windows batch files that provides comprehensive static analysis to identify syntax errors, security vulnerabilities, performance issues, and style problems.

  Version: `v1.1.27`

  <Expandable title="Blinter">
    <ResponseField name="reviews.tools.blinter.enabled" type="boolean">
      **Enable Blinter**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-smarty-lint" />

<ResponseField name="reviews.tools.smartyLint" type="object">
  smarty-lint is a linter for Smarty 3 template files that checks for common issues such as incorrect operator usage, naming conventions, empty blocks, and unquoted strings.

  Version: `v0.3.3`

  <Expandable title="Smarty Lint">
    <ResponseField name="reviews.tools.smartyLint.enabled" type="boolean">
      **Enable smarty-lint**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-ember-template-lint" />

<ResponseField name="reviews.tools.emberTemplateLint" type="object">
  ember-template-lint is a linter for Handlebars template files that checks for common issues such as accessibility violations, deprecated patterns, and template anti-patterns.

  Version: `v7.9.3`

  <Expandable title="Ember Template Lint">
    <ResponseField name="reviews.tools.emberTemplateLint.enabled" type="boolean">
      **Enable ember-template-lint**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-skillspector" />

<ResponseField name="reviews.tools.skillspector" type="object">
  SkillSpector is a security scanner for AI agent skills that detects vulnerabilities, malicious patterns, and security risks

  Version: `v2.11.2`

  <Expandable title="Skillspector">
    <ResponseField name="reviews.tools.skillspector.enabled" type="boolean">
      **Enable SkillSpector**: SkillSpector is a security scanner for AI agent skills. It detects vulnerabilities, malicious patterns, and security risks in SKILL.md manifests and MCP configurations.

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-psscriptanalyzer" />

<ResponseField name="reviews.tools.psscriptanalyzer" type="object">
  PSScriptAnalyzer is a static code checker for PowerShell scripts and modules.

  Version: `v1.25.0`

  <Expandable title="Psscriptanalyzer">
    <ResponseField name="reviews.tools.psscriptanalyzer.enabled" type="boolean">
      **Enable PSScriptAnalyzer**

      Defaults to `true`.
    </ResponseField>
  </Expandable>
</ResponseField>

## Chat

<span id="param-art" />

<ResponseField name="chat.art" type="boolean">
  Generate art in chat responses (ASCII or emoji).

  Defaults to `true`.
</ResponseField>

<span id="param-allow-non-org-members" />

<ResponseField name="chat.allow_non_org_members" type="boolean">
  Allow non-organization members to interact with CodeRabbit in comment chat. Set to false to restrict issue/review comment interactions to organization members on GitHub organization repositories. This does not affect automatic PR review eligibility.

  Defaults to `true`.
</ResponseField>

<span id="param-auto-reply" />

<ResponseField name="chat.auto_reply" type="boolean">
  Let CodeRabbit reply automatically without requiring a mention/tag.

  Defaults to `true`.
</ResponseField>

<span id="param-integrations" />

<h3 id="param-chat-integrations">
  Integrations
</h3>

`chat.integrations`

<span id="param-jira" />

<ResponseField name="chat.integrations.jira" type="object">
  <Expandable title="Jira">
    <span id="param-usage" />

    <ResponseField name="chat.integrations.jira.usage" type="enum">
      **Jira**: Allow creating Jira issues from chat. 'auto' disables the integration for public repositories.

      One of the following: `auto`, `enabled`, `disabled`

      Defaults to `"auto"`.
    </ResponseField>

    <span id="param-issue-template" />

    <ResponseField name="chat.integrations.jira.issue_template" type="string">
      **Jira Issue Template**: Structure to use for the description of Jira issues created from chat. Provide the headings your team expects, one per line, for example '## Goal', '## Description', '## Acceptance Criteria'. Leave empty to let CodeRabbit choose the structure.

      Defaults to `""`.

      <Info>
        Max length: 3000
      </Info>
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-linear" />

<ResponseField name="chat.integrations.linear" type="object">
  <Expandable title="Linear">
    <ResponseField name="chat.integrations.linear.usage" type="enum">
      **Linear**: Allow creating Linear issues from chat. 'auto' disables the integration for public repositories.

      One of the following: `auto`, `enabled`, `disabled`

      Defaults to `"auto"`.
    </ResponseField>
  </Expandable>
</ResponseField>

## Knowledge base

<span id="param-opt-out" />

<ResponseField name="knowledge_base.opt_out" type="boolean">
  **Opt Out**: Disable knowledge base features that require data retention. Opting out removes any existing stored knowledge base data.

  Defaults to `false`.
</ResponseField>

<span id="param-automatic-linking-mode" />

<ResponseField name="knowledge_base.automatic_linking_mode" type="enum">
  **Automatic Linking Mode**: For Auto, private repositories may automatically link to public or private repositories, while public repositories may automatically link only to public repositories. Enabled uses context from any eligible repository in the organization, whether public or private. Disabled creates no automatic repository links. Manual repository links configured below are unaffected.

  One of the following: `auto`, `enabled`, `disabled`

  Defaults to `"disabled"`.
</ResponseField>

<span id="param-automatic-repository-linking" />

<ResponseField name="knowledge_base.automatic_repository_linking" type="boolean">
  **Automatic Repository Linking**: Deprecated. This setting has no effect. Use knowledge\_base.automatic\_linking\_mode instead.

  Defaults to `false`.
</ResponseField>

<span id="param-linked-repositories" />

<ResponseField name="knowledge_base.linked_repositories" type="array of object">
  **Linked Repositories**: Repositories that CodeRabbit should consider when reviewing PRs in this repo. Use this to surface cross-repo dependencies and catch breaking changes across related codebases.

  Defaults to `[]`.

  Learn more: [Multi-Repo Analysis](/knowledge-base/multi-repo-analysis)

  <Expandable title="Array items">
    <span id="param-repository" />

    <ResponseField name="knowledge_base.linked_repositories[].repository" type="string">
      Repository name in owner/repo format (e.g., GitHub: myorg/backend-api, Azure DevOps: My Project/backend-api, GitLab: group/subgroup/repo, Bitbucket: workspace/repo)
    </ResponseField>

    <ResponseField name="knowledge_base.linked_repositories[].instructions" type="string">
      Optionally provide description and guidance on what this repository contains for CodeRabbit to consider during reviews. Example: 'Contains REST API endpoints and database models.'

      Defaults to `""`.

      <Info>
        Max length: 2000
      </Info>
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-web-search" />

<h3 id="param-knowledge-base-web-search">
  Web search
</h3>

`knowledge_base.web_search`

Learn more: [Web Search](/knowledge-base/web-search)

<ResponseField name="knowledge_base.web_search.enabled" type="boolean">
  **Web Search**: Use web search to gather additional context.

  Defaults to `true`.
</ResponseField>

<span id="param-code-guidelines" />

<h3 id="param-knowledge-base-code-guidelines">
  Code guidelines
</h3>

`knowledge_base.code_guidelines`

Use your coding guideline documents (see File Patterns) as review criteria.

Learn more: [Code Guidelines](/knowledge-base/code-guidelines)

<ResponseField name="knowledge_base.code_guidelines.enabled" type="boolean">
  **Enabled**: Apply your organization's coding standards during reviews.

  Defaults to `true`.
</ResponseField>

<span id="param-file-patterns" />

<ResponseField name="knowledge_base.code_guidelines.filePatterns" type="array of object">
  **File Patterns**: Additional guideline files, as glob strings or `{ files, applyTo }` objects. A string entry such as `**/CODING_STANDARDS.md` locates guideline files. An object entry sets `files` (the guideline documents) and `applyTo` (the source files they govern, for example `**/*.ts`), each a comma-separated list of globs. Either form can name a file in another repository of your organization as `repo:path` or `owner/repo:path` (for example `engineering-standards:frontend/react.md`), read from that repository's default branch. Supplements the [default patterns](/knowledge-base/code-guidelines#supported-files); does not replace them. File names are case-sensitive.

  Defaults to `[]`.
</ResponseField>

<span id="param-learnings" />

<h3 id="param-knowledge-base-learnings">
  Learnings
</h3>

`knowledge_base.learnings`

Learn more: [Learnings](/knowledge-base/learnings)

<span id="param-scope" />

<ResponseField name="knowledge_base.learnings.scope" type="enum">
  **Learnings**: Choose scope: 'local' (repo), 'global' (org), or 'auto' (local for public repos, global for private repos).

  One of the following: `local`, `global`, `auto`

  <ul>
    <li>`auto`: When reviewing a public repository, uses only that repository's learnings. When reviewing a private repository, uses all of your organization's learnings.</li>
    <li>`global`: Uses all of your organization's learnings in every review.</li>
    <li>`local`: Uses only the learnings of the repository being reviewed.</li>
  </ul>

  Defaults to `"auto"`.
</ResponseField>

<span id="param-approval-delay" />

<ResponseField name="knowledge_base.learnings.approval_delay" type="integer">
  Days admins have to approve or reject a learning before it is automatically applied. Must be an integer between 0 and 30. Set to 0 to apply learnings immediately without approval.

  Defaults to `0`.

  <Info>
    Min: 0, Max: 30
  </Info>
</ResponseField>

<span id="param-issues" />

<h3 id="param-knowledge-base-issues">
  Issues
</h3>

`knowledge_base.issues`

Learn more: [Knowledge Base overview](/knowledge-base#issue-trackers-and-past-pull-requests)

<ResponseField name="knowledge_base.issues.scope" type="enum">
  **Issues**: Choose scope for GitHub/GitLab issues: 'local' (repo), 'global' (org), or 'auto' (local for public repos, global for private repos).

  One of the following: `local`, `global`, `auto`

  Defaults to `"auto"`.
</ResponseField>

<h3 id="param-knowledge-base-jira">
  Jira
</h3>

`knowledge_base.jira`

Learn more: [Knowledge Base overview](/knowledge-base#issue-trackers-and-past-pull-requests)

<ResponseField name="knowledge_base.jira.usage" type="enum">
  **Jira**: Use Jira as a knowledge source. 'auto' disables the integration for public repositories.

  One of the following: `auto`, `enabled`, `disabled`

  Defaults to `"auto"`.
</ResponseField>

<span id="param-project-keys" />

<ResponseField name="knowledge_base.jira.project_keys" type="array of string">
  **Jira Project Keys**: Restrict Jira context to these projects.

  Defaults to `[]`.
</ResponseField>

<span id="param-excluded-project-keys" />

<ResponseField name="knowledge_base.jira.excluded_project_keys" type="array of string">
  **Jira Excluded Project Keys**: Never use these Jira projects as CodeRabbit context, regardless of repository allowlists. Managed at the workspace level as a security policy; exclusions always take precedence over any allowlist.

  Defaults to `[]`.
</ResponseField>

<h3 id="param-knowledge-base-linear">
  Linear
</h3>

`knowledge_base.linear`

Learn more: [Knowledge Base overview](/knowledge-base#issue-trackers-and-past-pull-requests)

<ResponseField name="knowledge_base.linear.usage" type="enum">
  **Linear**: Use Linear as a knowledge source. 'auto' disables the integration for public repositories.

  One of the following: `auto`, `enabled`, `disabled`

  Defaults to `"auto"`.
</ResponseField>

<span id="param-team-keys" />

<ResponseField name="knowledge_base.linear.team_keys" type="array of string">
  **Linear Team Keys**: Restrict Linear context to these teams (e.g. 'ENG').

  Defaults to `[]`.
</ResponseField>

<span id="param-pull-requests" />

<h3 id="param-knowledge-base-pull-requests">
  Pull requests
</h3>

`knowledge_base.pull_requests`

Learn more: [Knowledge Base overview](/knowledge-base#issue-trackers-and-past-pull-requests)

<ResponseField name="knowledge_base.pull_requests.scope" type="enum">
  **PRs**: Choose scope: 'local' (repo), 'global' (org), or 'auto' (local for public repos, global for private repos).

  One of the following: `local`, `global`, `auto`

  Defaults to `"auto"`.
</ResponseField>

<span id="param-mcp" />

<h3 id="param-knowledge-base-mcp">
  MCP
</h3>

`knowledge_base.mcp`

Learn more: [MCP Servers](/knowledge-base/mcp-context)

<ResponseField name="knowledge_base.mcp.usage" type="enum">
  **MCP**: Use MCP servers as a knowledge source. 'auto' disables the integration for public repositories.

  One of the following: `auto`, `enabled`, `disabled`

  <ul>
    <li>`auto`: Uses MCP servers as a knowledge source on private repositories and skips them on public repositories.</li>
    <li>`enabled`: Uses MCP servers on all repositories, including public ones.</li>
    <li>`disabled`: Never uses MCP servers as a knowledge source.</li>
  </ul>

  Defaults to `"auto"`.
</ResponseField>

<span id="param-disabled-servers" />

<ResponseField name="knowledge_base.mcp.disabled_servers" type="array of string">
  **Disabled MCP Servers**: Specify MCP server labels to disable (case-insensitive). These servers will be excluded from reviews and knowledge base queries.
</ResponseField>

## Code generation

<h3 id="param-code-generation-docstrings">
  Docstring Generation
</h3>

`code_generation.docstrings`

Settings for generating docstrings.

<ResponseField name="code_generation.docstrings.language" type="enum">
  Language for generated docstrings (ISO language code).

  One of the following: `de`, `de-DE`, `de-AT`, `de-CH`, `en`, `en-US`, `en-AU`, `en-GB`, `en-CA`, `en-NZ`, `en-ZA`, `es`, `es-AR`, `fr`, `fr-CA`, `fr-CH`, `fr-BE`, `nl`, `nl-BE`, `pt-AO`, `pt`, `pt-BR`, `pt-MZ`, `pt-PT`, `ar`, `ast-ES`, `ast`, `be-BY`, `be`, `br-FR`, `br`, `ca-ES`, `ca`, `ca-ES-valencia`, `ca-ES-balear`, `da-DK`, `da`, `de-DE-x-simple-language`, `el-GR`, `el`, `eo`, `fa`, `ga-IE`, `ga`, `gl-ES`, `gl`, `it`, `ja-JP`, `ja`, `km-KH`, `km`, `ko-KR`, `ko`, `pl-PL`, `pl`, `ro-RO`, `ro`, `ru-RU`, `ru`, `sk-SK`, `sk`, `sl-SI`, `sl`, `sv`, `ta-IN`, `ta`, `tl-PH`, `tl`, `tr`, `uk-UA`, `uk`, `zh-CN`, `zh`, `zh-TW`, `crh-UA`, `crh`, `cs-CZ`, `cs`, `nb`, `no`, `nl-NL`, `de-DE-x-simple-language-DE`, `es-ES`, `it-IT`, `fa-IR`, `sv-SE`, `de-LU`, `fr-FR`, `bg-BG`, `bg`, `he-IL`, `he`, `hi-IN`, `hi`, `vi-VN`, `vi`, `th-TH`, `th`, `bn-BD`, `bn`

  Defaults to `"en-US"`.
</ResponseField>

<ResponseField name="code_generation.docstrings.path_instructions" type="array of object">
  **Path Instructions**: Add path-specific guidelines for docstring generation.

  Defaults to `[]`.

  <Expandable title="Array items">
    <ResponseField name="code_generation.docstrings.path_instructions[].path" type="string">
      File path glob pattern. Example: `**/*.js`.
    </ResponseField>

    <ResponseField name="code_generation.docstrings.path_instructions[].instructions" type="string">
      Additional docstring-generation guidelines for matching paths.

      <Info>
        Max length: 20000
      </Info>
    </ResponseField>
  </Expandable>
</ResponseField>

<h3 id="param-code-generation-unit-tests">
  Unit Test Generation
</h3>

`code_generation.unit_tests`

Settings for generating unit tests.

<ResponseField name="code_generation.unit_tests.path_instructions" type="array of object">
  **Path Instructions**: Add path-specific guidelines for unit test generation.

  Defaults to `[]`.

  <Expandable title="Array items">
    <ResponseField name="code_generation.unit_tests.path_instructions[].path" type="string">
      File path glob pattern. Example: `**/*.js`.
    </ResponseField>

    <ResponseField name="code_generation.unit_tests.path_instructions[].instructions" type="string">
      Additional unit-test-generation guidelines for matching paths.

      <Info>
        Max length: 20000
      </Info>
    </ResponseField>
  </Expandable>
</ResponseField>

## Issue enrichment

<span id="param-auto-enrich" />

<h3 id="param-issue-enrichment-auto-enrich">
  Auto enrich
</h3>

`issue_enrichment.auto_enrich`

Settings for automatic issue enrichment.

<ResponseField name="issue_enrichment.auto_enrich.enabled" type="boolean">
  **Automatic Issue Enrichment**: Analyze and enrich issues with additional context (related code, potential solutions, complexity assessment).

  Defaults to `false`.
</ResponseField>

<span id="param-planning" />

<h3 id="param-issue-enrichment-planning">
  Planning
</h3>

`issue_enrichment.planning`

Settings for issue planning.

<ResponseField name="issue_enrichment.planning.enabled" type="boolean">
  **Issue Planning**: Generate an implementation plan for issues (early preview).

  Defaults to `true`.
</ResponseField>

<span id="param-auto-planning" />

<ResponseField name="issue_enrichment.planning.auto_planning" type="object">
  <Expandable title="Auto planning">
    <ResponseField name="issue_enrichment.planning.auto_planning.enabled" type="boolean">
      **Automatic Planning**: Trigger issue planning based on labels.

      Defaults to `true`.
    </ResponseField>

    <ResponseField name="issue_enrichment.planning.auto_planning.labels" type="array of string">
      Labels that trigger automatic issue planning. Labels starting with '!' are negative matches. Examples: \['feature', 'enhancement'] plans issues with either label. \['!wip'] plans all issues except those labeled 'wip'. \['feature', '!wip'] plans issues labeled 'feature' but not 'wip'.

      Defaults to `[]`.
    </ResponseField>
  </Expandable>
</ResponseField>

<span id="param-labeling" />

<h3 id="param-issue-enrichment-labeling">
  Labeling
</h3>

`issue_enrichment.labeling`

Settings for issue labeling.

<ResponseField name="issue_enrichment.labeling.labeling_instructions" type="array of object">
  **Labeling Instructions**: Define issue labels to suggest and when to suggest them.

  Defaults to `[]`.

  <Expandable title="Array items">
    <ResponseField name="issue_enrichment.labeling.labeling_instructions[].label" type="string">
      Label to suggest for the issue. Example: enhancement
    </ResponseField>

    <ResponseField name="issue_enrichment.labeling.labeling_instructions[].instructions" type="string">
      Instructions for the label. Example: New feature or request.

      <Info>
        Max length: 3000
      </Info>
    </ResponseField>
  </Expandable>
</ResponseField>

<ResponseField name="issue_enrichment.labeling.auto_apply_labels" type="boolean">
  Automatically apply suggested labels to the issue. When enabled without labeling instructions, labels are auto-suggested based on similar issues.

  Defaults to `false`.
</ResponseField>

## Related resources

<CardGroup cols={3}>
  <Card title="Review commands" icon="terminal" href="/reference/review-commands">
    Learn about @coderabbitai commands
  </Card>

  <Card title="Tools reference" icon="wrench" href="/tools/reference">
    Browse all supported linters and analyzers
  </Card>
</CardGroup>


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.