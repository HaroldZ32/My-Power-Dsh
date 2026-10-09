> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coderabbit.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Configuration via YAML file

> Learn how to configure CodeRabbit using a YAML file for advanced customization.

In this guide, we will cover the configuration using a YAML file. For the complete list of available options, see the [Configuration Reference](/reference/configuration). For ready-to-use examples tailored to specific frameworks and languages, see [Configuration Examples](/configuration/example).

<Tip>
  Prefer to write your configuration as code? [TypeScript configuration](/configuration/typescript-configuration) adds type checking, shared configuration fragments, and settings that adapt to the pull request or CLI invocation. A committed `.coderabbit.yaml` always takes precedence over `.coderabbit.config.ts`.
</Tip>

<Info>
  Move existing UI configuration to a YAML file?

  Use the `@coderabbitai configuration` command on any PR to get the resolved configuration in YAML format. The response includes source comments that show where settings came from, such as repository YAML, central configuration, UI settings, defaults, global overrides, etc. You can then copy the configuration to a `.coderabbit.yaml` file in the root of your repository.
</Info>

## Configure CodeRabbit using a YAML File

`.coderabbit.yaml` configuration file must be located in the root of the repository. The configuration present in the feature branch under review will be automatically detected and used by CodeRabbit for that review.

### Example Configuration

```yaml .coderabbit.yaml theme={null}
language: "en-US"
reviews:
  profile: "chill"
  request_changes_workflow: false
  high_level_summary: true
  poem: true
  review_status: true
  review_details: false
  auto_review:
    enabled: true
    drafts: false
chat:
  auto_reply: true
```

## Configuration Options

The configuration file supports numerous options for customizing CodeRabbit's behavior. For the complete list of available configuration options and their descriptions, see the [configuration reference](/reference/configuration).

<CardGroup cols={2}>
  <Card title="Configuration Reference" icon="book" href="/reference/configuration">
    Complete documentation of all options
  </Card>

  <Card title="Configuration Examples" icon="file-code" href="/configuration/example">
    Ready-to-use examples for popular frameworks and languages
  </Card>
</CardGroup>

## Shared configuration

Use shared configuration to share a CodeRabbit configuration across multiple repositories.

You can either reference a configuration file from a repository that CodeRabbit can read through the same platform connection it uses for reviews, or reference a publicly accessible configuration file by URL.

### Requirements

* The shared configuration repository must belong to the same owner or organization as the repository under review. A bare `repository:` name resolves within the reviewed repository's owner or organization.
* A `repository:` source can be public or private, but the CodeRabbit installation must be able to access it. If CodeRabbit is installed on selected repositories only, add the shared configuration repository to that selection.
* A `url:` source must be publicly reachable over HTTPS. CodeRabbit retrieves it without authentication and the request times out after five seconds.

To use shared configuration, you need to:

1. Create a `.coderabbit.yaml` file in a repository that meets the requirements above, or host it at a publicly accessible HTTPS URL.
2. Create a `.coderabbit.yaml` file in the root of your repository with the following content:

<Tabs>
  <Tab title="GitHub">
    GitHub repositories use the repository format.

    ```yaml theme={null}
    remote_config:
      repository: "shared-configs"
      ref: "main"
      path: ".shared-coderabbit.yaml"
    ```
  </Tab>

  <Tab title="GitLab">
    GitLab repositories use the full namespace path.

    ```yaml theme={null}
    remote_config:
      repository: "your_org_name/shared_configs"
      ref: "main"
      path: ".shared-coderabbit.yaml"
    ```
  </Tab>

  <Tab title="External URL (not recommended)">
    <Warning>
      Shared configuration via URL is not recommended because it must be publicly reachable and is retrieved without authentication, which may expose sensitive configuration details. Use the repository file configuration, [Central Configuration](/configuration/central-configuration) for managing configurations across multiple repositories, and [Configuration Inheritance](/configuration/configuration-inheritance) for reusing configurations across different layers.
    </Warning>

    ```yaml theme={null}
    remote_config:
      url: "https://your-config-location/.coderabbit.yaml"
    ```
  </Tab>
</Tabs>


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.