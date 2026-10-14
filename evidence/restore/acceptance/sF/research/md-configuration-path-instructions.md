> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coderabbit.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Path-based review instructions

> Customize how CodeRabbit reviews different parts of your codebase using glob patterns. Apply focused, context-aware instructions to controllers, tests, documentation, and more.

CodeRabbit provides two path controls. **Path filters** exclude files that don't benefit from review: lock files, binaries, and generated code. **Path instructions** apply targeted guidance to specific paths, such as security checks for API controllers, coverage requirements for tests, or clarity rules for documentation.

<Info>
  If your team already has coding guidelines and standards documented, point CodeRabbit to them using [Code Guidelines](/knowledge-base/code-guidelines).
</Info>

## Path instructions

Add custom review instructions for specific file paths using glob patterns. Instructions let you tell CodeRabbit exactly what to focus on for any part of the codebase.

### Configure path instructions

<Tabs>
  <Tab title="Configuration file">
    ```yaml .coderabbit.yaml lines icon="code" theme={null}
    reviews:
      path_instructions:
        - path: "src/controllers/**"
          instructions: |
            - Focus on authentication, authorization, and input validation.
            - Flag any direct database queries that bypass the ORM layer.
        - path: "tests/**"
          instructions: |
            Review the following unit test code written using the Mocha test library. Ensure that:
            - The code adheres to best practices associated with Mocha.
            - Descriptive test names are used to clearly convey the intent of each test.
            - Edge cases and error paths are covered.
        - path: "docs/**.md"
          instructions: |
            Check for clarity, accuracy, and completeness.
            Flag any references to deprecated APIs or outdated behavior.
    ```
  </Tab>

  <Tab title="Web UI">
    Configure path instructions in [Organization Settings → Reviews → Behavior](https://app.coderabbit.ai/organization/settings).

    <Frame caption="Path instructions configuration in the CodeRabbit web UI">
      <img src="https://mintcdn.com/coderabbit/pczHzFK8WGaZAY4u/assets/images/path-instructions-web-ui.png?fit=max&auto=format&n=pczHzFK8WGaZAY4u&q=85&s=3eb272d4fc5d766b5994b1c6d31055d6" alt="Path instructions configuration in the CodeRabbit web UI" width="1680" height="936" data-path="assets/images/path-instructions-web-ui.png" />
    </Frame>
  </Tab>
</Tabs>

<Info>
  Paths accept glob patterns. See the [minimatch](https://github.com/isaacs/minimatch) documentation for more information.
</Info>

<Warning>
  Path instructions only affect CodeRabbit's review guidance for matching files. They do not disable other features that inspect the same code. For example, suppressing docstring-related review guidance with `reviews.path_instructions` does not disable [Generate docstrings](/finishing-touches/docstrings) or the [Docstring Coverage pre-merge check](/pr-reviews/pre-merge-checks).
</Warning>

### When to add path instructions

CodeRabbit's built-in review logic covers a wide range of issues by default. Path instructions work best as a targeted supplement, not a replacement.

* Observe a few reviews first. If something is consistently missed or needs to be applied differently for a specific part of the codebase, that's a good candidate for a path instruction.

* When you identify a gap, consider which mechanism fits best:

  * **Path instructions** — rules scoped to specific files or directories in CodeRabbit's review.
  * **[Code guidelines](/knowledge-base/code-guidelines)** — existing standards documents (like `AGENTS.md` or `.cursorrules`) that CodeRabbit picks up automatically, and that also benefit AI coding agents.
  * **[Custom checks](/pr-reviews/custom-checks)** — pass/fail conditions you define that run as part of every review.

<Info>
  After CodeRabbit has reviewed several pull requests, it may have accumulated path-instruction suggestions. Post `@coderabbitai emit path instructions` as a PR comment to collect suggestions from the past 7 days and open a pull request that merges them into your `.coderabbit.yaml` without overwriting existing entries. See the [command reference](/reference/review-commands) for details.
</Info>

## Path filters

Path filters control which files CodeRabbit includes or excludes from review. Excluding irrelevant files, such as lock files, binaries, and generated code, keeps reviews focused and fast. CodeRabbit ships with sensible defaults, but you can extend the ignore list with your own patterns, or override defaults to force-include paths that would otherwise be skipped.

### Configure path filters

Patterns prefixed with `!` **exclude** paths from review (for example, `!src/generated/**` skips generated code). Patterns without `!` **include** paths.

<Info>
  Path filters define CodeRabbit's review scope. Files excluded here, or skipped by the default ignored paths below, do not appear in CodeRabbit review surfaces such as the walkthrough or [Change Stack](/change-stack). GitHub can still show those files in the pull request's full file list.
</Info>

<Tabs>
  <Tab title="Configuration file">
    ```yaml .coderabbit.yaml lines icon="code" theme={null}
    reviews:
      path_filters:
        - "src/**"
        - "!src/generated/**"
    ```
  </Tab>

  <Tab title="Web UI">
    Configure path filters in [Organization Settings → Reviews → Behavior](https://app.coderabbit.ai/organization/settings).

    <Frame caption="Path filters configuration in the CodeRabbit web UI">
      <img src="https://mintcdn.com/coderabbit/pczHzFK8WGaZAY4u/assets/images/path-filters-web-ui.png?fit=max&auto=format&n=pczHzFK8WGaZAY4u&q=85&s=92be0a856d08140c19787ebc86365419" alt="Path filters configuration in the CodeRabbit web UI" width="1302" height="508" data-path="assets/images/path-filters-web-ui.png" />
    </Frame>
  </Tab>
</Tabs>

### How path filters combine

| Rule | What it means |
| - | - |
| Exclusions win | Any matching `!` pattern excludes the file, regardless of pattern order. |
| Includes restrict scope | A pattern without `!` limits review to files matching an include. Use exclusions alone to keep other files eligible. |
| Exact default overrides are exempt | A default ignored pattern without its leading `!` disables that default without restricting review to an allowlist. |

<Warning>
  Using only `!**/*.json` and `**/package.json` excludes every file: the include limits review to package manifests, then the exclusion removes them. Narrow the exclusion instead of adding an include exception.
</Warning>

<Info>
  Path filters also influence repository checkout. Git's sparse-checkout rules differ from review matching, so tools may see a different file set.
</Info>

### Default ignored paths

CodeRabbit skips the paths below by default. To override one, copy its exact pattern without the leading `!`, for example `**/*.tsv`. Broad patterns such as `src/**` do not override defaults. On Azure DevOps, repository inventory and diff hydration apply these defaults directly rather than through your configured filters, so an override does not take effect on those two paths.

This list is the one the Pull Request review applies; the [VS Code extension](/ide) carries its own shorter list, so a file skipped here can still be reviewed there.

<Accordion title="Default ignored paths">
  <AccordionGroup>
    <Accordion title="Build and dependency directories">
      | Path Pattern | Description |
      | - | - |
      | `!**/dist/**` | Build output directory |
      | `!**/node_modules/**` | Node.js dependencies |
      | `!**/.svelte-kit/**` | SvelteKit build directory |
      | `!**/.webpack/**` | Webpack build directory |
      | `!**/.yarn/**` | Yarn cache directory |
      | `!**/.docusaurus/**` | Docusaurus build directory |
      | `!**/.temp/**` | Temporary files directory |
      | `!**/.cache/**` | Cache directory |
      | `!**/.next/**` | Next.js build directory |
      | `!**/.nuxt/**` | Nuxt.js build directory |
    </Accordion>

    <Accordion title="Lock files">
      | Path Pattern | Description |
      | - | - |
      | `!**/package-lock.json` | npm lock file |
      | `!**/yarn.lock` | Yarn lock file |
      | `!**/pnpm-lock.yaml` | pnpm lock file |
      | `!**/bun.lockb` | Bun lock file |
      | `!**/*.lock` | Generic lock files |
    </Accordion>

    <Accordion title="Generated code">
      | Path Pattern | Description |
      | - | - |
      | `!**/generated/**` | Generated code directory |
      | `!**/@generated/**` | Generated code directory (alternative) |
      | `!**/__generated__/**` | Generated code directory (alternative) |
      | `!**/__generated/**` | Generated code directory (alternative) |
      | `!**/_generated/**` | Generated code directory (alternative) |
      | `!**/gen/**` | Generated code directory (alternative) |
      | `!**/@gen/**` | Generated code directory (alternative) |
      | `!**/__gen__/**` | Generated code directory (alternative) |
      | `!**/__gen/**` | Generated code directory (alternative) |
      | `!**/_gen/**` | Generated code directory (alternative) |
      | `!**/*.generated.*` | Generated File Suffix |
      | `!**/*.tsbuildinfo` | TypeScript incremental build metadata |
    </Accordion>

    <Accordion title="Binary and compiled files">
      | Path Pattern | Description |
      | - | - |
      | `!**/*.app` | Application bundle |
      | `!**/*.bin` | Binary file |
      | `!**/*.class` | Java compiled class |
      | `!**/*.dll` | Windows dynamic library |
      | `!**/*.dylib` | macOS dynamic library |
      | `!**/*.exe` | Windows executable |
      | `!**/*.o` | Object file |
      | `!**/*.so` | Shared object file |
      | `!**/*.wasm` | WebAssembly file |
    </Accordion>

    <Accordion title="Archives and compressed files">
      | Path Pattern | Description |
      | - | - |
      | `!**/*.bz2` | Bzip2 archive |
      | `!**/*.gz` | Gzip archive |
      | `!**/*.xz` | XZ archive |
      | `!**/*.zip` | ZIP archive |
      | `!**/*.7z` | 7-Zip archive |
      | `!**/*.rar` | RAR archive |
      | `!**/*.zst` | Zstandard archive |
      | `!**/*.tar` | TAR archive |
      | `!**/*.jar` | Java archive |
      | `!**/*.war` | Web application archive |
      | `!**/*.nar` | NAR archive |
    </Accordion>

    <Accordion title="Media files">
      | Path Pattern | Description |
      | - | - |
      | `!**/*.mp3` | MP3 audio |
      | `!**/*.wav` | WAV audio |
      | `!**/*.wma` | WMA audio |
      | `!**/*.mp4` | MP4 video |
      | `!**/*.avi` | AVI video |
      | `!**/*.mkv` | MKV video |
      | `!**/*.wmv` | WMV video |
      | `!**/*.m4a` | M4A audio |
      | `!**/*.m4v` | M4V video |
      | `!**/*.3gp` | 3GP video |
      | `!**/*.3g2` | 3G2 video |
      | `!**/*.rm` | RealMedia video |
      | `!**/*.mov` | QuickTime video |
      | `!**/*.flv` | Flash video |
      | `!**/*.swf` | Flash animation |
      | `!**/*.flac` | FLAC audio |
      | `!**/*.ogg` | OGG audio |
    </Accordion>

    <Accordion title="Images and fonts">
      | Path Pattern | Description |
      | - | - |
      | `!**/*.ico` | Icon file |
      | `!**/*.svg` | SVG image |
      | `!**/*.jpeg` | JPEG image |
      | `!**/*.jpg` | JPEG image |
      | `!**/*.png` | PNG image |
      | `!**/*.gif` | GIF image |
      | `!**/*.bmp` | BMP image |
      | `!**/*.tiff` | TIFF image |
      | `!**/*.webm` | WebM image |
      | `!**/*.ttf` | TrueType font |
      | `!**/*.otf` | OpenType font |
      | `!**/*.woff` | Web Open Font Format |
      | `!**/*.woff2` | Web Open Font Format 2 |
      | `!**/*.eot` | Embedded OpenType font |
    </Accordion>

    <Accordion title="Documents and data files">
      | Path Pattern | Description |
      | - | - |
      | `!**/*.pdf` | PDF document |
      | `!**/*.doc` | Word document |
      | `!**/*.docx` | Word document |
      | `!**/*.xls` | Excel spreadsheet |
      | `!**/*.xlsx` | Excel spreadsheet |
      | `!**/*.ppt` | PowerPoint presentation |
      | `!**/*.pptx` | PowerPoint presentation |
      | `!**/*.csv` | CSV data file |
      | `!**/*.tsv` | TSV data file |
      | `!**/*.dat` | Data file |
      | `!**/*.db` | Database file |
      | `!**/*.parquet` | Parquet data file |
    </Accordion>

    <Accordion title="Development and system files">
      | Path Pattern | Description |
      | - | - |
      | `!**/tags` | Tags file |
      | `!**/.tags` | Tags file |
      | `!**/TAGS` | Tags file |
      | `!**/.TAGS` | Tags file |
      | `!**/.DS_Store` | macOS system file |
      | `!**/.cscope.files` | Cscope files |
      | `!**/.cscope.out` | Cscope output |
      | `!**/.cscope.in.out` | Cscope input/output |
      | `!**/.cscope.po.out` | Cscope output |
      | `!**/*.log` | Log file |
      | `!**/*.map` | Source map |
      | `!**/*.out` | Output file |
      | `!**/*.sum` | Checksum file |
      | `!**/*.work` | Work file |
      | `!**/*.md5sum` | MD5 checksum file |
    </Accordion>

    <Accordion title="Game and 3D assets">
      | Path Pattern | Description |
      | - | - |
      | `!**/*.tga` | Targa image |
      | `!**/*.dds` | DirectDraw surface |
      | `!**/*.psd` | Photoshop document |
      | `!**/*.fbx` | FBX 3D model |
      | `!**/*.obj` | OBJ 3D model |
      | `!**/*.blend` | Blender file |
      | `!**/*.dae` | COLLADA 3D model |
      | `!**/*.gltf` | GL Transmission Format |
      | `!**/*.hlsl` | HLSL shader |
      | `!**/*.glsl` | GLSL shader |
      | `!**/*.unity` | Unity scene |
      | `!**/*.umap` | Unreal map |
      | `!**/*.prefab` | Unity prefab |
      | `!**/*.mat` | Material file |
      | `!**/*.shader` | Shader file |
      | `!**/*.shadergraph` | Shader graph |
      | `!**/*.sav` | Save file |
      | `!**/*.scene` | Scene file |
      | `!**/*.asset` | Asset file |
    </Accordion>

    <Accordion title="Python-specific files">
      | Path Pattern | Description |
      | - | - |
      | `!**/*.pyc` | Python compiled file |
      | `!**/*.pyd` | Python dynamic module |
      | `!**/*.pyo` | Python optimized file |
      | `!**/*.pkl` | Python pickle file |
      | `!**/*.pickle` | Python pickle file |
    </Accordion>

    <Accordion title="Go-specific files">
      | Path Pattern | Description |
      | - | - |
      | `!**/*.pb.go` | Protocol buffer Go file |
      | `!**/*.pb.gw.go` | Protocol buffer gateway Go file |
    </Accordion>

    <Accordion title="Terraform files">
      | Path Pattern | Description |
      | - | - |
      | `!**/*.tfstate` | Terraform state file |
      | `!**/*.tfstate.backup` | Terraform state backup |
    </Accordion>

    <Accordion title="Xcode-specific files">
      | Path Pattern | Description |
      | - | - |
      | `!**/*.xcworkspace/contents.xcworkspacedata` | Xcode workspace metadata |
      | `!**/Package.resolved` | Swift Package Manager resolved-dependencies file |
    </Accordion>

    <Accordion title="Minified files">
      | Path Pattern | Description |
      | - | - |
      | `!**/*.min.js` | Minified JavaScript |
      | `!**/*.min.js.map` | Minified JavaScript source map |
      | `!**/*.min.css` | Minified CSS |
    </Accordion>

    <Accordion title="Bundler output with content hashes">
      Bundlers write production assets with a content hash in the filename, often outside `dist/` and not minified enough to match `!**/*.min.js`. These patterns match that shape. The eight-character class is the hash itself: it is the URL-safe alphabet (letters, digits, `-` and `_`) that Rollup and Vite use by default, spelled out because glob patterns have no repetition syntax. Path matching is case-insensitive, so the lowercase `a-z` in each class covers uppercase hash characters too: `assets/index-DUKDdC5R.js` matches.

      Because the hash width is part of the pattern, a hand-written file is normally unaffected: `assets/index-page.js` and `src/editor.chunk.js` are still reviewed. A hand-written name whose segment happens to be exactly eight of those characters would be skipped; if that applies to you, override the rule as shown below.

      | Path Pattern | Description |
      | - | - |
      | `!**/*.[0-9a-z_-][0-9a-z_-][0-9a-z_-][0-9a-z_-][0-9a-z_-][0-9a-z_-][0-9a-z_-][0-9a-z_-].chunk.js` | Hashed JavaScript chunk |
      | `!**/*.[0-9a-z_-][0-9a-z_-][0-9a-z_-][0-9a-z_-][0-9a-z_-][0-9a-z_-][0-9a-z_-][0-9a-z_-].chunk.css` | Hashed CSS chunk |
      | `!**/assets/index-[0-9a-z_-][0-9a-z_-][0-9a-z_-][0-9a-z_-][0-9a-z_-][0-9a-z_-][0-9a-z_-][0-9a-z_-].js` | Hashed JavaScript asset bundle |
      | `!**/assets/index-[0-9a-z_-][0-9a-z_-][0-9a-z_-][0-9a-z_-][0-9a-z_-][0-9a-z_-][0-9a-z_-][0-9a-z_-].css` | Hashed CSS asset bundle |

      To review these files anyway, copy the pattern into your `path_filters` **without** the leading `!`, exactly as written above. As with every default rule, that override does not reach Azure DevOps repository inventory and diff hydration, which apply the defaults directly. Any file a default rule skips is also listed in the review's ignored-files summary, so you can see what was left out.
    </Accordion>
  </AccordionGroup>
</Accordion>

## What's next

<CardGroup cols={1}>
  <Card title="AST-based instructions" icon="code" href="/configuration/ast-grep-instructions" horizontal>
    Write review instructions using ast-grep rules for precise, syntax-aware review instructions.
  </Card>

  <Card title="Code guidelines" icon="book" href="/knowledge-base/code-guidelines" horizontal>
    Point CodeRabbit to your existing coding standards documents: `AGENTS.md`, `.cursorrules`, and similar files.
  </Card>

  <Card title="Custom checks" icon="copy-check" href="/pr-reviews/custom-checks" horizontal>
    Define pass/fail conditions that run as part of every review to enforce your team's standards automatically.
  </Card>
</CardGroup>


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.