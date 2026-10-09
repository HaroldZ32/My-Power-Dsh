> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coderabbit.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Tools configuration reference

> Complete reference for all CodeRabbit supported tools and their configuration options.

<Info>
  This reference is generated automatically. **Last updated: October 6, 2026**
</Info>

CodeRabbit supports integration with **59 static analysis tools**, linters, and security scanners. You can configure each tool individually via the web interface or your `.coderabbit.yaml` file, see the [configuration overview](/guides/configuration-overview) for details.

## All tools

<AccordionGroup>
  <Accordion title="actionlint" icon="github" id="actionlint">
    actionlint is a static checker for GitHub Actions workflow files.

    Version: `v1.7.12`

    * [Configuration guide](/tools/actionlint)
    * [actionlint web page](https://github.com/rhysd/actionlint)

    **Configuration options:**

    <span id="param-enabled" />

    <ResponseField name="reviews.tools.actionlint.enabled" type="boolean">
      **Enable actionlint**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        actionlint:
          enabled: true
    ```
  </Accordion>

  <Accordion title="ast-grep" icon="search" id="ast-grep">
    ast-grep is a code analysis tool that helps you to find patterns in your codebase using abstract syntax trees patterns.

    Version: `v0.45.3`

    * [Configuration guide](/tools/ast-grep)
    * [ast-grep web page](https://ast-grep.github.io)

    **Configuration options:**

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

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        ast-grep:
          enabled: true
          rule_dirs: []
          util_dirs: []
          essential_rules: true
          packages: []
    ```
  </Accordion>

  <Accordion title="Biome" icon="wind" id="biome">
    Biome is a fast formatter, linter, and analyzer for web projects.

    Version: `v2.5.13`

    * [Configuration guide](/tools/biome)
    * [Biome web page](https://biomejs.dev)

    **Configuration options:**

    <ResponseField name="reviews.tools.biome.enabled" type="boolean">
      **Enable Biome**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        biome:
          enabled: true
    ```
  </Accordion>

  <Accordion title="Blinter" icon="terminal" id="blinter">
    Blinter is a linter for Windows batch files that provides comprehensive static analysis to identify syntax errors, security vulnerabilities, performance issues, and style problems.

    Version: `v1.1.27`

    * [Configuration guide](/tools/blinter)
    * [Blinter web page](https://github.com/tboy1337/Blinter)

    **Configuration options:**

    <ResponseField name="reviews.tools.blinter.enabled" type="boolean">
      **Enable Blinter**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        blinter:
          enabled: true
    ```
  </Accordion>

  <Accordion title="Brakeman" icon="shield" id="brakeman">
    Brakeman is a static analysis security vulnerability scanner for Ruby on Rails applications.

    Version: `v8.0.6`

    * [Configuration guide](/tools/brakeman)
    * [Brakeman web page](https://brakemanscanner.org)

    **Configuration options:**

    <ResponseField name="reviews.tools.brakeman.enabled" type="boolean">
      **Enable Brakeman**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        brakeman:
          enabled: true
    ```
  </Accordion>

  <Accordion title="Buf" icon="package" id="buf">
    Buf offers linting for Protobuf files.

    Version: `v1.73.0`

    * [Configuration guide](/tools/buf)
    * [Buf web page](https://buf.build)

    **Configuration options:**

    <ResponseField name="reviews.tools.buf.enabled" type="boolean">
      **Enable Buf**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        buf:
          enabled: true
    ```
  </Accordion>

  <Accordion title="checkmake" icon="hammer" id="checkmake">
    checkmake is a linter for Makefiles.

    Version: `v0.3.2`

    * [Configuration guide](/tools/checkmake)
    * [checkmake web page](https://github.com/mrtazz/checkmake)

    **Configuration options:**

    <ResponseField name="reviews.tools.checkmake.enabled" type="boolean">
      **Enable checkmake**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        checkmake:
          enabled: true
    ```
  </Accordion>

  <Accordion title="Checkov" icon="cloud" id="checkov">
    Checkov is a static code analysis tool for infrastructure-as-code files.

    Version: `v3.3.17`

    * [Configuration guide](/tools/checkov)
    * [Checkov web page](https://www.checkov.io)

    **Configuration options:**

    <ResponseField name="reviews.tools.checkov.enabled" type="boolean">
      **Enable Checkov**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        checkov:
          enabled: true
    ```
  </Accordion>

  <Accordion title="CircleCI" icon="circle" id="circleci">
    CircleCI tool is a static checker for CircleCI config files.

    Version: `v1.0.50462`

    * [Configuration guide](/tools/circleci)
    * [CircleCI web page](https://circleci.com)

    **Configuration options:**

    <ResponseField name="reviews.tools.circleci.enabled" type="boolean">
      **Enable CircleCI**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        circleci:
          enabled: true
    ```
  </Accordion>

  <Accordion title="Clang" icon="wrench" id="clang-tidy">
    Configuration for Clang to perform static analysis on C and C++ code

    Version: `v14.0.6`

    * [Configuration guide](/tools/clang-tidy)
    * [Clang web page](https://clang.llvm.org/extra/clang-tidy)

    **Configuration options:**

    <ResponseField name="reviews.tools.clang.enabled" type="boolean">
      Enable Clang for C/C++ static analysis and code quality checks

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        clang:
          enabled: true
    ```
  </Accordion>

  <Accordion title="Clippy" icon="wrench" id="clippy">
    Clippy is a collection of lints to catch common mistakes and improve your Rust code.

    * [Configuration guide](/tools/clippy)
    * [Clippy web page](https://github.com/rust-lang/rust-clippy)

    **Configuration options:**

    <ResponseField name="reviews.tools.clippy.enabled" type="boolean">
      **Enable Clippy**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        clippy:
          enabled: true
    ```
  </Accordion>

  <Accordion title="Cppcheck" icon="code" id="cppcheck">
    Cppcheck is a static code analysis tool for the C and C++ programming languages.

    Version: `v2.21.0`

    * [Configuration guide](/tools/cppcheck)
    * [Cppcheck web page](https://cppcheck.sourceforge.io)

    **Configuration options:**

    <ResponseField name="reviews.tools.cppcheck.enabled" type="boolean">
      **Enable Cppcheck**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        cppcheck:
          enabled: true
    ```
  </Accordion>

  <Accordion title="detekt" icon="braces" id="detekt">
    Detekt is a static code analysis tool for Kotlin files.

    Version: `v1.23.8`

    * [Configuration guide](/tools/detekt)
    * [detekt web page](https://detekt.dev)

    **Configuration options:**

    <ResponseField name="reviews.tools.detekt.enabled" type="boolean">
      **Enable detekt**: detekt is a static code analysis tool for Kotlin files.

      Defaults to `true`.
    </ResponseField>

    <span id="param-config-file" />

    <ResponseField name="reviews.tools.detekt.config_file" type="string">
      Optional path to the detekt configuration file relative to the repository.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        detekt:
          enabled: true
          config_file: "detekt.yml"
    ```
  </Accordion>

  <Accordion title="Dotenv Lint" icon="file-key" id="dotenv">
    dotenv-linter is a tool for checking and fixing .env files for problems and best practices

    Version: `v4.0.0`

    * [Configuration guide](/tools/dotenv)
    * [Dotenv Lint web page](https://github.com/dotenv-linter/dotenv-linter)

    **Configuration options:**

    <ResponseField name="reviews.tools.dotenvLint.enabled" type="boolean">
      **Enable dotenv-linter**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        dotenvLint:
          enabled: true
    ```
  </Accordion>

  <Accordion title="Ember Template Lint" icon="braces" id="ember-template-lint">
    ember-template-lint is a linter for Handlebars template files that checks for common issues such as accessibility violations, deprecated patterns, and template anti-patterns.

    Version: `v7.9.3`

    * [Configuration guide](/tools/ember-template-lint)
    * [Ember Template Lint web page](https://github.com/ember-template-lint/ember-template-lint)

    **Configuration options:**

    <ResponseField name="reviews.tools.emberTemplateLint.enabled" type="boolean">
      **Enable ember-template-lint**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        emberTemplateLint:
          enabled: true
    ```
  </Accordion>

  <Accordion title="ESLint" icon="code" id="eslint">
    ESLint is a static code analysis tool for JavaScript files.

    * [Configuration guide](/tools/eslint)
    * [ESLint web page](https://eslint.org)

    **Configuration options:**

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
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        eslint:
          enabled: true
          config_file: ".eslint.yml"
          e18e: {}
    ```
  </Accordion>

  <Accordion title="Flake8" icon="python" id="flake8">
    Flake8 is a Python linter that wraps PyFlakes, pycodestyle and Ned Batchelder's McCabe script.

    Version: `v7.3.0`

    * [Configuration guide](/tools/flake8)
    * [Flake8 web page](https://flake8.pycqa.org)

    **Configuration options:**

    <ResponseField name="reviews.tools.flake8.enabled" type="boolean">
      **Enable Flake8**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        flake8:
          enabled: true
    ```
  </Accordion>

  <Accordion title="Fortitude" icon="code" id="fortitude">
    Fortitude is a Fortran linter that checks for code quality and style issues.

    Version: `v0.9.2`

    * [Configuration guide](/tools/fortitude)
    * [Fortitude web page](https://github.com/PlasmaFAIR/fortitude)

    **Configuration options:**

    <ResponseField name="reviews.tools.fortitudeLint.enabled" type="boolean">
      **Enable Fortitude**: Fortitude is a Fortran linter that checks for code quality and style issues

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        fortitudeLint:
          enabled: true
    ```
  </Accordion>

  <Accordion title="GitHub Checks" icon="github" id="github-checks">
    GitHub Checks integration configuration.

    * [Configuration guide](/tools/github-checks)

    **Configuration options:**

    <ResponseField name="reviews.tools.github-checks.enabled" type="boolean">
      **Enable GitHub Checks**: Enable integration, defaults to true

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        github-checks:
          enabled: true
    ```
  </Accordion>

  <Accordion title="Gitleaks" icon="key" id="betterleaks">
    Betterleaks is a secret scanner (an improved version of Gitleaks).

    Version: `v1.8.1`

    * [Configuration guide](/tools/betterleaks)
    * [Gitleaks web page](https://github.com/betterleaks/betterleaks)

    **Configuration options:**

    <ResponseField name="reviews.tools.gitleaks.enabled" type="boolean">
      **Enable Betterleaks**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        gitleaks:
          enabled: true
    ```
  </Accordion>

  <Accordion title="golangci-lint" icon="braces" id="golangci-lint">
    golangci-lint is a fast linters runner for Go.

    Version: `v2.13.2`

    * [Configuration guide](/tools/golangci-lint)
    * [golangci-lint web page](https://golangci-lint.run)

    **Configuration options:**

    <ResponseField name="reviews.tools.golangci-lint.enabled" type="boolean">
      **Enable golangci-lint**

      Defaults to `true`.
    </ResponseField>

    <ResponseField name="reviews.tools.golangci-lint.config_file" type="string">
      Optional path to the golangci-lint configuration file relative to the repository. Useful when the configuration file is named differently than the default '.golangci.yml', '.golangci.yaml', '.golangci.toml', '.golangci.json'.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        golangci-lint:
          enabled: true
          config_file: ".golangci.yml"
    ```
  </Accordion>

  <Accordion title="Hadolint" icon="box" id="hadolint">
    Hadolint is a Dockerfile linter.

    Version: `v2.15.1`

    * [Configuration guide](/tools/hadolint)
    * [Hadolint web page](https://github.com/hadolint/hadolint)

    **Configuration options:**

    <ResponseField name="reviews.tools.hadolint.enabled" type="boolean">
      **Enable Hadolint**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        hadolint:
          enabled: true
    ```
  </Accordion>

  <Accordion title="HTMLHint" icon="code" id="htmlhint">
    HTMLHint is a static code analysis tool for HTML files.

    Version: `v1.9.2`

    * [Configuration guide](/tools/htmlhint)
    * [HTMLHint web page](https://htmlhint.com)

    **Configuration options:**

    <ResponseField name="reviews.tools.htmlhint.enabled" type="boolean">
      **Enable HTMLHint**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        htmlhint:
          enabled: true
    ```
  </Accordion>

  <Accordion title="Infer" icon="code" id="fbinfer">
    Configuration for Infer to find bugs in Java and C/C++ code

    Version: `v1.3.0`

    * [Configuration guide](/tools/fbinfer)
    * [Infer web page](https://fbinfer.com)

    **Configuration options:**

    <ResponseField name="reviews.tools.fbinfer.enabled" type="boolean">
      Enable Infer for static bug analysis in Java and C/C++ code

      Defaults to `true`.
    </ResponseField>

    <span id="param-enable-java" />

    <ResponseField name="reviews.tools.fbinfer.enable_java" type="boolean">
      **Enable Java analysis**: Disabled by default because Java analysis may require compiling more than the changed files.

      Defaults to `false`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        fbinfer:
          enabled: true
    ```
  </Accordion>

  <Accordion title="LanguageTool" icon="languages" id="languagetool">
    LanguageTool is a style and grammar checker for 30+ languages.

    * [Configuration guide](/tools/languagetool)
    * [LanguageTool web page](https://languagetool.org)

    **Configuration options:**

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

      One of: `default`, `picky`

      Defaults to `"default"`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        languagetool:
          enabled: true
          enabled_rules: []
          disabled_rules: []
          enabled_categories: []
          disabled_categories: []
          level: "default"
    ```
  </Accordion>

  <Accordion title="Luacheck" icon="moon" id="luacheck">
    Configuration for Lua code linting to ensure code quality

    Version: `v1.2.0`

    * [Configuration guide](/tools/luacheck)
    * [Luacheck web page](https://github.com/mpeterv/luacheck)

    **Configuration options:**

    <ResponseField name="reviews.tools.luacheck.enabled" type="boolean">
      **Enable Lua code linting**: Luacheck helps maintain consistent and error-free Lua code

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        luacheck:
          enabled: true
    ```
  </Accordion>

  <Accordion title="markdownlint" icon="file-text" id="markdownlint">
    markdownlint-cli2 is a static analysis tool to enforce standards and consistency for Markdown files.

    Version: `v0.23.2`

    * [Configuration guide](/tools/markdownlint)
    * [markdownlint web page](https://github.com/DavidAnson/markdownlint)

    **Configuration options:**

    <ResponseField name="reviews.tools.markdownlint.enabled" type="boolean">
      **Enable markdownlint**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        markdownlint:
          enabled: true
    ```
  </Accordion>

  <Accordion title="oasdiff" icon="git-compare" id="oasdiff">
    oasdiff detects breaking changes between OpenAPI specifications.

    Version: `v1.32.1`

    * [Configuration guide](/tools/oasdiff)
    * [oasdiff web page](https://github.com/oasdiff/oasdiff)

    **Configuration options:**

    <ResponseField name="reviews.tools.oasdiff.enabled" type="boolean">
      **Enable oasdiff**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        oasdiff:
          enabled: true
    ```
  </Accordion>

  <Accordion title="OpenGrep" icon="search" id="opengrep">
    OpenGrep is a high-performance static code analysis engine, compatible with Semgrep configurations.

    Version: `v1.30.0`

    * [Configuration guide](/tools/opengrep)
    * [OpenGrep web page](https://github.com/opengrep/opengrep)

    **Configuration options:**

    <ResponseField name="reviews.tools.opengrep.enabled" type="boolean">
      **Enable OpenGrep**: OpenGrep is a high-performance static code analysis engine for finding security vulnerabilities and bugs across 17+ languages.

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        opengrep:
          enabled: true
    ```
  </Accordion>

  <Accordion title="OSV Scanner" icon="shield" id="osv-scanner">
    OSV Scanner is a tool for vulnerability package scanning.

    Version: `v2.6.0`

    * [Configuration guide](/tools/osv-scanner)
    * [OSV Scanner web page](https://google.github.io/osv-scanner)

    **Configuration options:**

    <ResponseField name="reviews.tools.osvScanner.enabled" type="boolean">
      **Enable OSV Scanner**: OSV Scanner is a tool for vulnerability package scanning

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        osvScanner:
          enabled: true
    ```
  </Accordion>

  <Accordion title="Oxlint" icon="zap" id="oxlint">
    Oxlint is a JavaScript/TypeScript linter for OXC written in Rust.

    Version: `v1.83.0`

    * [Configuration guide](/tools/oxlint)
    * [Oxlint web page](https://oxc.rs/docs/guide/usage/linter)

    **Configuration options:**

    <ResponseField name="reviews.tools.oxc.enabled" type="boolean">
      **Enable Oxlint**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        oxc:
          enabled: true
    ```
  </Accordion>

  <Accordion title="PHP CodeSniffer" icon="php" id="phpcs">
    PHP CodeSniffer is a PHP linter and coding standard checker.

    Version: `v3.13.6`

    * [Configuration guide](/tools/phpcs)
    * [PHP CodeSniffer web page](https://github.com/squizlabs/PHP_CodeSniffer)

    **Configuration options:**

    <ResponseField name="reviews.tools.phpcs.enabled" type="boolean">
      **Enable PHP CodeSniffer**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        phpcs:
          enabled: true
    ```
  </Accordion>

  <Accordion title="PHPMD" icon="php" id="phpmd">
    PHPMD is a tool to find potential problems in PHP code.

    Version: `v2.15.0`

    * [Configuration guide](/tools/phpmd)
    * [PHPMD web page](https://phpmd.org)

    **Configuration options:**

    <ResponseField name="reviews.tools.phpmd.enabled" type="boolean">
      **Enable PHPMD**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        phpmd:
          enabled: true
    ```
  </Accordion>

  <Accordion title="PHPStan" icon="php" id="phpstan">
    PHPStan is a tool to analyze PHP code.

    Version: `v2.2.14`

    * [Configuration guide](/tools/phpstan)
    * [PHPStan web page](https://phpstan.org)

    **Configuration options:**

    <ResponseField name="reviews.tools.phpstan.enabled" type="boolean">
      **Enable PHPStan**: PHPStan requires [config file](https://phpstan.org/config-reference#config-file) in your repository root. Please ensure that this file contains the `paths:` parameter.

      Defaults to `true`.
    </ResponseField>

    <ResponseField name="reviews.tools.phpstan.level" type="enum">
      **Level**: Specify the [rule level](https://phpstan.org/user-guide/rule-levels) to run. When set to `default`, the level is determined by the review profile: `chill` uses level 3 (real bugs only — return/property type mismatches, array offset errors) and `assertive` uses level 8 (adds dead code detection, argument type checking, null safety, and typehint checks). This setting is ignored if your configuration file already has a `level:` parameter.

      One of: `0`, `1`, `2`, `3`, `4`, `5`, `6`, `7`, `8`, `9`, `default`, `max`

      Defaults to `"default"`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        phpstan:
          enabled: true
          level: "default"
    ```
  </Accordion>

  <Accordion title="PMD" icon="coffee" id="pmd">
    PMD is an extensible multilanguage static code analyzer. It’s mainly concerned with Java.

    Version: `v7.27.0`

    * [Configuration guide](/tools/pmd)
    * [PMD web page](https://pmd.github.io)

    **Configuration options:**

    <ResponseField name="reviews.tools.pmd.enabled" type="boolean">
      **Enable PMD**

      Defaults to `true`.
    </ResponseField>

    <ResponseField name="reviews.tools.pmd.config_file" type="string">
      Optional path to the PMD configuration file relative to the repository.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        pmd:
          enabled: true
          config_file: "ruleset.xml"
    ```
  </Accordion>

  <Accordion title="Presidio" icon="shield" id="presidio">
    Microsoft Presidio Analyzer 2.2.364 detects sensitive identifiers (including payment cards, US SSN, cryptocurrency wallets, and phone numbers) in changed files. Tune entities, thresholds, and languages in repository Presidio configuration (for example .presidiocli or AnalyzerEngineProvider YAML); the built-in scan uses fixed defaults and is skipped when that configuration is present.

    Version: `v2.2.364`

    * [Configuration guide](/tools/presidio)
    * [Presidio web page](https://microsoft.github.io/presidio)

    **Configuration options:**

    <ResponseField name="reviews.tools.presidio.enabled" type="boolean">
      Enable Microsoft Presidio Analyzer for high-signal PII in changed files

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        presidio:
          enabled: true
    ```
  </Accordion>

  <Accordion title="Prisma Lint" icon="database" id="prisma-lint">
    Configuration for Prisma Schema linting to ensure schema file quality

    Version: `v0.13.1`

    * [Configuration guide](/tools/prisma-lint)
    * [Prisma Lint web page](https://github.com/loop-payments/prisma-lint)

    **Configuration options:**

    <ResponseField name="reviews.tools.prismaLint.enabled" type="boolean">
      **Enable Prisma Schema linting**: Prisma Schema linting helps maintain consistent and error-free schema files

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        prismaLint:
          enabled: true
    ```
  </Accordion>

  <Accordion title="PSScriptAnalyzer" icon="terminal" id="psscriptanalyzer">
    PSScriptAnalyzer is a static code checker for PowerShell scripts and modules.

    Version: `v1.25.0`

    * [Configuration guide](/tools/psscriptanalyzer)
    * [PSScriptAnalyzer web page](https://github.com/PowerShell/PSScriptAnalyzer)

    **Configuration options:**

    <ResponseField name="reviews.tools.psscriptanalyzer.enabled" type="boolean">
      **Enable PSScriptAnalyzer**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        psscriptanalyzer:
          enabled: true
    ```
  </Accordion>

  <Accordion title="Pylint" icon="python" id="pylint">
    Pylint is a Python static code analysis tool.

    Version: `v4.0.8`

    * [Configuration guide](/tools/pylint)
    * [Pylint web page](https://pylint.pycqa.org)

    **Configuration options:**

    <ResponseField name="reviews.tools.pylint.enabled" type="boolean">
      **Enable Pylint**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        pylint:
          enabled: true
    ```
  </Accordion>

  <Accordion title="React Doctor" icon="stethoscope" id="react-doctor">
    React Doctor scans React codebases for security, performance, correctness, and accessibility issues.

    Version: `v0.9.14`

    * [Configuration guide](/tools/react-doctor)
    * [React Doctor web page](https://github.com/millionco/react-doctor)

    **Configuration options:**

    <ResponseField name="reviews.tools.reactDoctor.enabled" type="boolean">
      **Enable React Doctor**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        reactDoctor:
          enabled: true
    ```
  </Accordion>

  <Accordion title="Regal" icon="shield-check" id="regal">
    Regal is a linter and language server for Rego.

    Version: `v0.42.0`

    * [Configuration guide](/tools/regal)
    * [Regal web page](https://www.openpolicyagent.org/projects/regal)

    **Configuration options:**

    <ResponseField name="reviews.tools.regal.enabled" type="boolean">
      **Enable Regal**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        regal:
          enabled: true
    ```
  </Accordion>

  <Accordion title="RuboCop" icon="gem" id="rubocop">
    RuboCop is a Ruby static code analyzer (a.k.a. linter ) and code formatter.

    Version: `v1.91.0`

    * [Configuration guide](/tools/rubocop)
    * [RuboCop web page](https://rubocop.org)

    **Configuration options:**

    <ResponseField name="reviews.tools.rubocop.enabled" type="boolean">
      **Enable RuboCop**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        rubocop:
          enabled: true
    ```
  </Accordion>

  <Accordion title="Ruff" icon="flame" id="ruff">
    Ruff is a Python linter and code formatter.

    Version: `v0.16.7`

    * [Configuration guide](/tools/ruff)
    * [Ruff web page](https://docs.astral.sh/ruff)

    **Configuration options:**

    <ResponseField name="reviews.tools.ruff.enabled" type="boolean">
      **Enable Ruff**

      Defaults to `true`.
    </ResponseField>

    <ResponseField name="reviews.tools.ruff.config_file" type="string">
      Optional path to a Ruff configuration file relative to the repository. When set, this configuration is used for every reviewed file instead of Ruff's closest-config discovery.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        ruff:
          enabled: true
          config_file: ".eslint.yml"
    ```
  </Accordion>

  <Accordion title="Semgrep" icon="shield-alert" id="semgrep">
    Semgrep is a static analysis tool designed to scan code for security vulnerabilities and code quality issues.

    Version: `v1.177.0`

    * [Configuration guide](/tools/semgrep)
    * [Semgrep web page](https://semgrep.dev)

    **Configuration options:**

    <ResponseField name="reviews.tools.semgrep.enabled" type="boolean">
      **Enable Semgrep**

      Defaults to `true`.
    </ResponseField>

    <ResponseField name="reviews.tools.semgrep.config_file" type="string">
      Optional path to the Semgrep configuration file relative to the repository.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        semgrep:
          enabled: true
          config_file: ".semgrep.yml"
    ```
  </Accordion>

  <Accordion title="ShellCheck" icon="terminal" id="shellcheck">
    ShellCheck is a static analysis tool that finds bugs in your shell scripts.

    Version: `v0.11.0`

    * [Configuration guide](/tools/shellcheck)
    * [ShellCheck web page](https://www.shellcheck.net)

    **Configuration options:**

    <ResponseField name="reviews.tools.shellcheck.enabled" type="boolean">
      **Enable ShellCheck**: ShellCheck is a static analysis tool that finds bugs in your shell.

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        shellcheck:
          enabled: true
    ```
  </Accordion>

  <Accordion title="Shopify Theme Check" icon="shopping-bag" id="shopify-cli">
    Configuration for Shopify Theme Check to ensure theme quality and best practices

    Version: `cli 4.8.0, theme 3.58.2`

    * [Configuration guide](/tools/shopify-cli)
    * [Shopify Theme Check web page](https://shopify.dev/docs/themes/tools/theme-check)

    **Configuration options:**

    <ResponseField name="reviews.tools.shopifyThemeCheck.enabled" type="boolean">
      **Enable Shopify Theme Check**: A linter for Shopify themes that helps you follow Shopify theme & Liquid best practices

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        shopifyThemeCheck:
          enabled: true
    ```
  </Accordion>

  <Accordion title="SkillSpector" icon="shield" id="skillspector">
    SkillSpector is a security scanner for AI agent skills that detects vulnerabilities, malicious patterns, and security risks

    Version: `v2.11.2`

    * [Configuration guide](/tools/skillspector)
    * [SkillSpector web page](https://github.com/nvidia/skillspector)

    **Configuration options:**

    <ResponseField name="reviews.tools.skillspector.enabled" type="boolean">
      **Enable SkillSpector**: SkillSpector is a security scanner for AI agent skills. It detects vulnerabilities, malicious patterns, and security risks in SKILL.md manifests and MCP configurations.

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        skillspector:
          enabled: true
    ```
  </Accordion>

  <Accordion title="Smarty Lint" icon="braces" id="smarty-lint">
    smarty-lint is a linter for Smarty 3 template files that checks for common issues such as incorrect operator usage, naming conventions, empty blocks, and unquoted strings.

    Version: `v0.3.3`

    * [Configuration guide](/tools/smarty-lint)
    * [Smarty Lint web page](https://github.com/modix/smarty-lint)

    **Configuration options:**

    <ResponseField name="reviews.tools.smartyLint.enabled" type="boolean">
      **Enable smarty-lint**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        smartyLint:
          enabled: true
    ```
  </Accordion>

  <Accordion title="SQLFluff" icon="database" id="sqlfluff">
    SQLFluff is an open source, dialect-flexible and configurable SQL linter.

    Version: `v4.3.0`

    * [Configuration guide](/tools/sqlfluff)
    * [SQLFluff web page](https://sqlfluff.com)

    **Configuration options:**

    <ResponseField name="reviews.tools.sqlfluff.enabled" type="boolean">
      **Enable SQLFluff**

      Defaults to `true`.
    </ResponseField>

    <ResponseField name="reviews.tools.sqlfluff.config_file" type="string">
      Optional path to the SQLFluff configuration file relative to the repository. Use this when the config file is not named one of SQLFluff's default filenames.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        sqlfluff:
          enabled: true
          config_file: "custom/.sqlfluff"
    ```
  </Accordion>

  <Accordion title="Squawk" icon="wrench" id="squawk">
    Configuration for Squawk to lint Postgres migrations and SQL for safe schema changes

    Version: `v2.65.0`

    * [Configuration guide](/tools/squawk)
    * [Squawk web page](https://squawkhq.com)

    **Configuration options:**

    <ResponseField name="reviews.tools.squawk.enabled" type="boolean">
      **Enable Squawk for Postgres migration linting**: Detects unsafe schema changes that can cause downtime or blocking locks

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        squawk:
          enabled: true
    ```
  </Accordion>

  <Accordion title="Stylelint" icon="paint-bucket" id="stylelint">
    Stylelint is a linter for stylesheets (CSS, SCSS, Sass, Less, SugarSS, Stylus) that helps avoid errors and enforce conventions.

    Version: `v17.14.0`

    * [Configuration guide](/tools/stylelint)
    * [Stylelint web page](https://stylelint.io)

    **Configuration options:**

    <ResponseField name="reviews.tools.stylelint.enabled" type="boolean">
      **Enable Stylelint**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        stylelint:
          enabled: true
    ```
  </Accordion>

  <Accordion title="SwiftLint" icon="smartphone" id="swiftlint">
    SwiftLint integration configuration object.

    Version: `v0.65.1`

    * [Configuration guide](/tools/swiftlint)
    * [SwiftLint web page](https://realm.github.io/SwiftLint)

    **Configuration options:**

    <ResponseField name="reviews.tools.swiftlint.enabled" type="boolean">
      **Enable SwiftLint**: SwiftLint is a Swift linter.

      Defaults to `true`.
    </ResponseField>

    <ResponseField name="reviews.tools.swiftlint.config_file" type="string">
      Optional path to the SwiftLint configuration file relative to the repository. This is useful when the configuration file is named differently than the default '.swiftlint.yml' or '.swiftlint.yaml'.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        swiftlint:
          enabled: true
          config_file: ".swiftlint.yml"
    ```
  </Accordion>

  <Accordion title="TFLint" icon="layers" id="tflint">
    TFLint is a Terraform linter for finding potential errors and enforcing best practices.

    Version: `v0.64.0`

    * [Configuration guide](/tools/tflint)
    * [TFLint web page](https://github.com/terraform-linters/tflint)

    **Configuration options:**

    <ResponseField name="reviews.tools.tflint.enabled" type="boolean">
      **Enable TFLint**: TFLint is a Terraform linter for finding potential errors.

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        tflint:
          enabled: true
    ```
  </Accordion>

  <Accordion title="Trivy" icon="scan" id="trivy">
    Trivy is a comprehensive security scanner that detects misconfigurations and secrets in Infrastructure as Code files

    Version: `v0.74.0`

    * [Configuration guide](/tools/trivy)
    * [Trivy web page](https://trivy.dev)

    **Configuration options:**

    <ResponseField name="reviews.tools.trivy.enabled" type="boolean">
      Enable Trivy for security scanning of IaC files (Terraform, Kubernetes, Docker, etc.)

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        trivy:
          enabled: true
    ```
  </Accordion>

  <Accordion title="TruffleHog" icon="key" id="trufflehog">
    TruffleHog is a secret scanner with verification capabilities that can detect and verify secrets in code.

    Version: `v3.96.0`

    * [Configuration guide](/tools/trufflehog)
    * [TruffleHog web page](https://github.com/trufflesecurity/trufflehog)

    **Configuration options:**

    <ResponseField name="reviews.tools.trufflehog.enabled" type="boolean">
      **Enable TruffleHog**: TruffleHog is a secret scanner with verification capabilities.

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        trufflehog:
          enabled: true
    ```
  </Accordion>

  <Accordion title="Vale" icon="spell-check" id="vale">
    Vale lints prose using the repository's checked-in style rules.

    Version: `v3.21.0`

    * [Configuration guide](/tools/vale)
    * [Vale web page](https://vale.sh)

    **Configuration options:**

    <ResponseField name="reviews.tools.vale.enabled" type="boolean">
      **Enable Vale**: Vale checks prose against repository-defined editorial style rules. It runs only when a supported root Vale configuration is present.

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        vale:
          enabled: true
    ```
  </Accordion>

  <Accordion title="Verilator" icon="cpu" id="verilator">
    Verilator statically analyzes Verilog and SystemVerilog source files.

    Version: `v5.052`

    * [Configuration guide](/tools/verilator)
    * [Verilator web page](https://www.veripool.org/verilator/)

    **Configuration options:**

    <ResponseField name="reviews.tools.verilator.enabled" type="boolean">
      **Enable Verilator**: Verilator lints Verilog and SystemVerilog for syntax, width, connectivity, and behavioral correctness issues.

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        verilator:
          enabled: true
    ```
  </Accordion>

  <Accordion title="YAMLlint" icon="file-code" id="yamllint">
    YAMLlint is a linter for YAML files.

    Version: `v1.37.1`

    * [Configuration guide](/tools/yamllint)
    * [YAMLlint web page](https://yamllint.readthedocs.io)

    **Configuration options:**

    <ResponseField name="reviews.tools.yamllint.enabled" type="boolean">
      **Enable YAMLlint**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        yamllint:
          enabled: true
    ```
  </Accordion>

  <Accordion title="zizmor" icon="shield" id="zizmor">
    zizmor is a static security analyzer for GitHub Actions workflow files.

    Version: `v1.30.1`

    * [Configuration guide](/tools/zizmor)
    * [zizmor web page](https://docs.zizmor.sh)

    **Configuration options:**

    <ResponseField name="reviews.tools.zizmor.enabled" type="boolean">
      **Enable zizmor**

      Defaults to `true`.
    </ResponseField>

    **Example configuration:**

    ```yaml .coderabbit.yaml lines theme={null}
    reviews:
      tools:
        zizmor:
          enabled: true
    ```
  </Accordion>
</AccordionGroup>

## What's next

<CardGroup cols={1}>
  <Card title="Configuration reference" icon="settings" href="/reference/configuration" horizontal>
    View the complete reference for all CodeRabbit configuration options and settings.
  </Card>

  <Card title="Review commands" icon="terminal" href="/reference/review-commands" horizontal>
    Learn how to control and customize code reviews using @coderabbitai commands.
  </Card>
</CardGroup>


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.