> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coderabbit.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Configuration overview

> Configure CodeRabbit to fit your organization and repositories using multiple approaches with clear priority rules.

export const Hint = ({type, children, headline, tip, href, cta}) => {
  const TIPS = {
    learnings: {
      headline: "Learnings",
      tip: "Review preferences CodeRabbit learns from your chat conversations and applies automatically to future reviews.",
      cta: "Learn about Learnings",
      href: "/knowledge-base/learnings",
      content: "Learnings"
    },
    walkthrough: {
      headline: "PR Walkthrough",
      tip: "A structured comment posted by CodeRabbit at the top of every pull request, summarizing changes, sequence diagrams, review effort, and more.",
      cta: "Learn about PR Walkthroughs",
      href: "/pr-reviews/walkthroughs",
      content: "Walkthrough"
    },
    "finishing-touches": {
      headline: "Finishing Touches",
      tip: "Post-review agentic actions (Autofix, writing docstrings or unit tests, and more) you trigger from a PR comment or a checkbox in the Walkthrough.",
      cta: "See all Finishing Touches",
      href: "/finishing-touches",
      content: "Finishing Touches"
    },
    "coding-plan": {
      headline: "Coding Plan",
      tip: "A detailed, codebase-aware implementation plan CodeRabbit generates from an issue or description, ready to hand off to any coding agent.",
      cta: "Learn about Coding Plans",
      href: "/plan",
      content: "Coding Plan"
    },
    "knowledge-base": {
      headline: "Knowledge Base",
      tip: "The collected context sources CodeRabbit draws on during reviews: Learnings, Code Guidelines, issue trackers, connected MCP servers, and cross-repo analysis.",
      cta: "Explore the Knowledge Base",
      href: "/knowledge-base",
      content: "Knowledge Base"
    },
    "path-instructions": {
      headline: "Path Instructions",
      tip: "Custom review rules that only apply to files matching a glob pattern, e.g. 'src/controllers/**'.",
      cta: "Configure path instructions",
      href: "/configuration/path-instructions",
      content: "Path Instructions"
    },
    "change-stack": {
      headline: "Change Stack",
      tip: "An improved code inspection interface that reorganizes a pull request from a flat file list into a structured, layer-by-layer walkthrough with range-specific summaries and diagrams when useful.",
      cta: "Learn about Change Stack",
      href: "/change-stack",
      content: "Change Stack"
    },
    scope: {
      headline: "Scope",
      tip: "A named set of repositories, connections, and spend limits that controls what CodeRabbit Agent can access in a given Slack conversation.",
      cta: "Learn about Scopes",
      href: "/slack-agent/scopes",
      content: "Scope"
    },
    "coderabbit-agent": {
      headline: "CodeRabbit Agent for Slack",
      tip: "An AI agent built into Slack that investigates issues, generates implementation plans, and opens pull requests right from the Slack threads.",
      cta: "Explore CodeRabbit Agent",
      href: "/slack-agent",
      content: "CodeRabbit Agent"
    },
    "configuration-inheritance": {
      headline: "Configuration Inheritance",
      tip: "A setting that merges configuration values across multiple levels — repository YAML, central YAML, and UI settings — instead of using only the highest-priority source.",
      cta: "Learn about Configuration Inheritance",
      href: "/configuration/configuration-inheritance",
      content: "Configuration Inheritance"
    },
    "coding-agent": {
      headline: "Coding Agent",
      tip: "Turns a user request, a review finding, a coding plan or a failing CI check into a task that CodeRabbit's agent implements in the cloud, then delivers as a commit or a stacked pull request for you to approve.",
      cta: "Learn about Coding Agent",
      href: "/code",
      content: "Coding Agent"
    },
    triage: {
      headline: "Triage",
      tip: "A single cross-repository queue of open pull requests, ranked by what each one needs next and what acting on it is worth.",
      cta: "Learn about Triage",
      href: "/triage",
      content: "Triage"
    }
  };
  const defaults = TIPS[type] || ({});
  return <Tooltip headline={headline ?? defaults.headline} tip={tip ?? defaults.tip} cta={cta ?? defaults.cta} href={href ?? defaults.href}>
      {children ?? defaults.content}
    </Tooltip>;
};

CodeRabbit works out of the box with sensible defaults, but configuration lets you customize reviews for your team's specific needs. Choose from multiple configuration approaches based on your workflow preferences.

## Configuration approaches

### File-based

<CardGroup cols={2}>
  <Card title="YAML file (recommended)" icon="file-code" href="/getting-started/yaml-configuration">
    Version-controlled configuration committed to your repository
  </Card>

  <Card title="TypeScript file" icon="braces" href="/configuration/typescript-configuration">
    Programmatic, type-checked configuration that can adapt to the pull request or CLI invocation
  </Card>

  <Card title="Central configuration" icon="layers" href="/configuration/central-configuration">
    Organization-wide configuration from a dedicated repository
  </Card>
</CardGroup>

### Web Interface-based

<CardGroup cols={2}>
  <Card title="Repository settings" icon="git-branch" href="/guides/repository-settings">
    Configure individual repositories with specific needs
  </Card>

  <Card title="Organization settings" icon="building-2" href="/guides/organization-settings">
    Apply the same configuration to all repositories in your organization
  </Card>
</CardGroup>

### YAML file (recommended)

Create a `.coderabbit.yaml` file in your repository root for version-controlled configuration. This approach gives you the benefits of infrastructure-as-code: configuration changes go through code review, maintain history, and deploy with your application.

Best for: Teams that prefer GitOps workflows and want configuration changes tracked in version control.

See the [sample configurations](/configuration/example) for language-specific recommendations and [configuration reference](/reference/configuration) for all available options.

### TypeScript file

Create a `.coderabbit.config.ts` file in your repository root to author configuration as code. You get editor autocomplete and author-time type checking, you can generate repetitive settings programmatically, compose shared fragments, and adapt configuration to the pull request or invocation source - for example, applying a stricter review profile to hotfixes or using a different profile for local CLI reviews.

Best for: Teams whose configuration has outgrown static YAML, or organizations distributing shared configuration across many repositories.

<Warning>
  A committed `.coderabbit.yaml` or `.coderabbit.yml` always takes precedence over `.coderabbit.config.ts`. If either YAML file exists, it wins and the TypeScript file is ignored.
</Warning>

See [TypeScript configuration](/configuration/typescript-configuration).

### Central configuration

Create a dedicated `coderabbit` repository in your organization with a `.coderabbit.yaml` file. This configuration automatically applies to any repository that doesn't have its own settings, giving you organization-wide defaults with the flexibility of repository-specific overrides.

Best for: Organizations wanting centralized configuration management without requiring individual repository setup.

See [Central configuration](/configuration/central-configuration) for setup instructions and platform support.

### Repository settings

Use repository settings when different projects need different CodeRabbit configurations. Configure each repository individually through the web UI or with a local `.coderabbit.yaml` file.

Best for: Organizations with diverse projects requiring specific review approaches.

See [Repository settings](/guides/repository-settings).

### Organization settings

Use organization settings when you want consistent CodeRabbit behavior across all your repositories. Configure once in the web UI and all repositories inherit the same settings. The web interface offers three view modes: **Concise** for the most common settings, **All Settings** for full control, and **YAML Editor** for direct YAML editing. Concise and All Settings modes include a live Preview panel.

Best for: Teams with standardized coding practices across projects.

See [Organization settings](/guides/organization-settings).

Workspace settings are available for Enterprise workspace customers. In CodeRabbit Cloud, this includes SSO workspaces and self-hosted Git provider organizations linked to a workspace. SSO workspace admins can manage these settings. For linked self-hosted organizations, viewing requires permission to view Organization Settings, and saving requires permission to update Organization Settings.

Enterprise SSO workspaces on CodeRabbit Cloud can also enable [**Use workspace settings as defaults**](/management/sso#use-workspace-settings-as-defaults) to fill unset repository or organization values without changing explicit values. See the linked setting documentation for availability and precedence details.

## Understanding configuration priority

Configuration sources don't merge by default. When you use multiple configuration methods, CodeRabbit follows a strict priority hierarchy:

<table style={{ width: "100%", tableLayout: "fixed" }}>
  <thead>
    <tr>
      <th style={{ width: "20%", textAlign: "left" }}>Priority</th>
      <th style={{ width: "25%", textAlign: "left" }}>Source</th>
      <th style={{ width: "55%", textAlign: "left" }}>Location</th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td>0 (Highest)</td>
      <td><a href="/guides/configuration-overview#global-overrides">Workspace global overrides</a></td>
      <td>CodeRabbit UI - Workspace Settings - Global Overrides (Enterprise workspace customers)</td>
    </tr>

    <tr>
      <td>1</td>
      <td><a href="/guides/configuration-overview#global-overrides">Organization global overrides</a></td>
      <td>CodeRabbit UI - Organization Settings - Global Overrides</td>
    </tr>

    <tr>
      <td>2</td>
      <td><a href="/getting-started/yaml-configuration">Repository file</a></td>
      <td><code>.coderabbit.yaml</code> or <a href="/configuration/typescript-configuration"><code>.coderabbit.config.ts</code></a> in the repository</td>
    </tr>

    <tr>
      <td>3</td>
      <td><a href="/configuration/central-configuration">Central repository</a></td>
      <td><code>.coderabbit.yaml</code> or <code>.coderabbit.config.ts</code> in <code>coderabbit</code> repository</td>
    </tr>

    <tr>
      <td>4</td>
      <td><a href="/guides/repository-settings">Repository settings</a></td>
      <td>CodeRabbit UI - Repository Settings</td>
    </tr>

    <tr>
      <td>5</td>
      <td><a href="/guides/organization-settings">Organization settings</a></td>
      <td>CodeRabbit UI - Organization Settings</td>
    </tr>

    <tr>
      <td>6</td>
      <td>Workspace settings</td>
      <td>CodeRabbit UI - Workspace Settings (Enterprise workspace customers)</td>
    </tr>

    <tr>
      <td>7 (Lowest)</td>
      <td><a href="/reference/configuration">Default settings</a></td>
      <td>CodeRabbit schema defaults</td>
    </tr>
  </tbody>
</table>

<Warning>
  You can enable `configuration inheritance` to [let CodeRabbit merge configuration](/configuration/configuration-inheritance) from parent levels instead of using only the highest-priority source.
</Warning>

**Example:** If you set a custom timeout in organization settings and central configuration but have a local `.coderabbit.yaml` that doesn't mention timeouts and <Hint type="configuration-inheritance" /> is disabled, CodeRabbit uses the default timeout value, not your organization or central configuration settings.

<Info>
  To see exactly which layer each setting came from, run `@coderabbitai configuration` on any pull request. The resolved YAML is annotated with sources (repository YAML, central configuration, UI settings, defaults, etc.) so you can diagnose priority conflicts without guessing.
</Info>

## Global overrides

Global overrides let administrators enforce settings across every repository and PR review, regardless of what individual repositories configure in their `.coderabbit.yaml` files or repository-level UI settings.

Best for: Enforcing compliance policies, mandatory review profiles, or required path instructions that no repository can opt out of.

<Warning>
  Global overrides take precedence over **all** other configuration sources, including repository `.coderabbit.yaml` files. Use them for policies that must be enforced across a workspace or organization (for example, compliance-driven review profiles or required path instructions) rather than for general defaults.
</Warning>

Enterprise workspace customers can also configure workspace-level global overrides. In SSO workspaces, this requires workspace-admin access. For linked self-hosted Git provider organizations, saving overrides requires permission to update Organization Settings. Workspace global overrides are applied after organization global overrides and take precedence when both levels set the same key.

<Info>
  If a setting is not behaving as expected, run `@coderabbitai configuration` on any pull request. The resolved YAML is annotated with the source that supplied each value, making it easy to identify when a global override is silently winning above your repository or organization configuration. Possible sources are:

  * **Repository YAML** — `.coderabbit.yaml` in the repository
  * **Central YAML** — `.coderabbit.yaml` in the `coderabbit` repository
  * **Environment YAML** — `YAML_CONFIG` environment variable (self-hosted only)
  * **Repository UI** — CodeRabbit UI repository settings
  * **Organization UI** — CodeRabbit UI organization settings
  * **Workspace UI** — CodeRabbit UI workspace settings (enterprise only)
  * **Defaults** — CodeRabbit schema defaults
  * **Global overrides** — organization or workspace overrides (enterprise only)
</Info>

### Who can configure global overrides

SSO workspace admins can view and edit workspace global overrides. For linked self-hosted Git provider organizations, viewing requires permission to view Organization Settings, and editing requires permission to update Organization Settings. Organization admins can view and edit organization global overrides.

### How to set global overrides

1. In the CodeRabbit UI, open **CodeRabbit configuration** for an SSO workspace, **Workspace Settings** for a linked self-hosted organization, or your [**Organization Settings**](https://app.coderabbit.ai/settings/organizations) page.
2. In the settings mode switcher, select **Global Overrides**.
3. Edit the YAML using the same schema as `.coderabbit.yaml` ([schema.v2.json](https://coderabbit.ai/integrations/schema.v2.json)). Only include the keys you want to enforce - leave everything else out.
4. Save. The overrides take effect on subsequent PR reviews across the workspace or organization.

Example - enforce an assertive review profile and a required path instruction on every repository:

```yaml .coderabbit.yaml theme={null}
reviews:
  profile: assertive
  path_instructions:
    - path: "**/*.sql"
      instructions: "Flag any statements that drop or truncate tables."
```

### Override behavior

Global overrides are applied on top of the fully-resolved configuration using these rules:

| Type | Behavior |
| - | - |
| **Objects** | Merged recursively - override properties replace matching properties at each nesting level |
| **Arrays** | Combined by key - override entries take priority when keys match (e.g., matching `path` in `path_instructions`); unique entries from other sources are kept |
| **Scalars** | Simple override - the override value wins |

<Note>
  Arrays in global overrides follow the same merge logic as [configuration inheritance](/configuration/configuration-inheritance) - entries are merged by a stable key (for example, `path` for `path_instructions`). Override entries take priority when keys match, while unique entries from other sources are kept.
</Note>

### Enforcing inheritance

Setting `inheritance: true` in a global override **enforces [configuration inheritance](/configuration/configuration-inheritance) across the entire organization or workspace**. Every repository and PR review merges the full inheritance chain - including repositories that set `inheritance: false` (or omit it) in their own `.coderabbit.yaml` or UI settings. The override's `inheritance` flag is evaluated before the inheritance walk and takes precedence over each level's own flag, so no repository can opt out. This lets administrators turn on inheritance everywhere from a single place, instead of adding `inheritance: true` to every configuration source.

## Adaptive configuration

Besides manual configuration, CodeRabbit automatically builds learnings about your team's review preferences based on your interactions with review comments over time. This creates a dynamic, self-improving layer.

Learnings capture patterns like:

* Which types of suggestions your team typically accepts or rejects
* Coding standards specific to your repositories
* Review focus areas that matter most to your workflow

<CardGroup cols={1}>
  <Card title="Learnings" icon="brain" href="/knowledge-base/learnings" horizontal>
    How learnings work and how to manage them
  </Card>
</CardGroup>


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.