# Directory Index Generator TypeScript/npm Specification

## Purpose

Create a Node.js 20 ESM package that generates an `index.html` in a specified
directory and every subdirectory. The package must be executable with npx and
must provide a reusable TypeScript library API.

The npm package name is `directory-index-to-html`. The CLI binary name is
`directory-index`.

Example:

```shell
npx directory-index-to-html --folder ./site
```

## Package and distribution

- Target Node.js 20 LTS or newer.
- Publish an ESM-only package.
- Provide TypeScript declarations.
- Build output must include:
  - `dist/index.js`, the library entrypoint.
  - `dist/index.d.ts`, the public type declarations.
  - `dist/cli.js`, the executable entrypoint.
- `package.json` must expose `directory-index-to-html` as the package name and
  `directory-index` as the `bin` command.
- The CLI entrypoint must have a Node shebang and executable package metadata.
- Include MIT license metadata and package documentation.

## Command-line interface

Use Commander.

```text
directory-index --folder <path> [--template <path>]
```

- `--folder` is required and identifies the root directory to index.
- `--template` is optional.
- Paths must be resolved before traversal.
- When `--template` is omitted, use the built-in default template.
- When `--template` is provided, read and parse that file once before any
  directory traversal.
- Template files must be read as UTF-8.
- Invalid arguments, missing paths, template parse failures, rendering errors,
  filesystem errors, and commit failures must produce a clear stderr error and
  exit with code `1`.
- Success must print:
  `Generated indexes under '<absolute-root>'.`
- Success must exit with code `0`.

## Public library API

Export an async function with an options-object shape equivalent to:

```ts
interface GenerateDirectoryIndexesOptions {
  folder: string;
  template?: string;
  templateName?: string;
  fileProvider?: DirectoryFileProvider;
  outputWriter?: DirectoryOutputWriter;
}

interface GenerateDirectoryIndexesResult {
  pageCount: number;
  pages: string[];
}

async function generateDirectoryIndexes(
  options: GenerateDirectoryIndexesOptions,
): Promise<GenerateDirectoryIndexesResult>;
```

The physical filesystem implementation is the default. The core traversal and
rendering logic must consume injected abstractions rather than hardcoding
filesystem access.

Keep the API provider-neutral and expose suitable types for:

- reading immediate directory entries;
- reading a file;
- detecting symlinks;
- reading template source;
- writing or committing staged pages.

A representative abstraction is:

```ts
interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

interface DirectoryFileProvider {
  readDirectory(path: string): Promise<DirectoryEntry[]>;
  readFile(path: string): Promise<string>;
  isSymbolicLink(path: string): Promise<boolean>;
}

interface DirectoryOutputWriter {
  writeAll(
    outputRoot: string,
    pages: ReadonlyMap<string, string>,
  ): Promise<void>;
}
```

Exact helper names may vary, but the public implementation must preserve the
separation between traversal/rendering and filesystem/output concerns.

## Generation behavior

- Generate `index.html` in the root directory and every subdirectory.
- Enumerate immediate children for each page.
- Recurse into child directories.
- Include dot-prefixed and hidden entries.
- Exclude generated `index.html` files case-insensitively.
- If the template file is under the scanned root, exclude that exact normalized
  file path from listings.
- Skip symlinks and reparse-point-like entries. With the physical adapter,
  `Dirent.isSymbolicLink()` must make an entry non-traversable and non-listable.
- Do not follow symlinks while constructing directory paths.
- Overwrite existing `index.html` files only after all pages have rendered and
  the staged transaction is ready to commit.
- Treat the supplied custom template as trusted input, but expose only listing
  data to it. Do not expose filesystem operations, Node APIs, environment
  variables, process handles, application services, or custom application
  functions.

## Template engine

Custom templates use LiquidJS, not Scriban syntax.

- Parse each custom template once before traversal.
- Report parse failures with the template name/path and clear parser messages.
- Rendering failure must prevent the output writer from being called.
- Use strict undefined-variable checks.
- HTML-escape interpolated values for custom templates.
- Built-in templates must be self-contained and use no external assets.
- The template controls HTML and layout only.

Templates that migrate from the C# Scriban implementation must use LiquidJS
syntax. They need not be source-compatible with Scriban.

## Liquid data contract

Expose lower-snake-case variables and properties:

- `directory`
  - `name`: current directory name.
  - `path`: path relative to the scanned root, using `/`; empty for the root.
- `entries`: immediate children, each with:
  - `name`: entry name.
  - `path`: path relative to the scanned root, using `/`.
  - `is_directory`: whether the entry is a directory.
  - `href`: URL-escaped path relative to the current page.
- `breadcrumbs`: root-to-current path, each with:
  - `name`: breadcrumb label.
  - `href`: URL-escaped relative link to that ancestor's generated index.
  - `is_current`: whether this crumb is the current directory.

The current breadcrumb is plain text rather than a link.

### Entry links

- A file entry links to `href` itself.
- A directory entry links to `<url-escaped-directory-name>/index.html`.
- Relative entry names and paths must use `/`, regardless of the host OS.
- Use URL path-segment escaping for names. Preserve existing slash-delimited
  provider paths.

### Breadcrumb links

- The root-to-current chain uses relative links from the current page:
  - root: `index.html`;
  - child of root: `../index.html`;
  - deeper ancestors: repeated `..` segments followed by `index.html`.
- The current breadcrumb's `href` may be present but must not be rendered as a
  link.

## Built-in default template

The built-in template must:

1. Show breadcrumbs at the top.
2. Show the current directory heading.
3. List directories before files.
4. Sort each group alphabetically by name:
   - primary comparison: case-insensitive;
   - tie-break: deterministic ordinal case-sensitive comparison.
5. Show `No files or folders` when the directory has no listable entries.
6. Use directory and file `href` values supplied by the data model.
7. Produce fully self-contained HTML without external assets.

## Path and root rules

- Reject null, empty, or whitespace-only root paths.
- Resolve `--folder` and `--template` to absolute paths.
- The root must exist and be a directory.
- A custom template must exist and be a regular, readable file.
- Root names must be based on the directory basename. A filesystem-root path
  with no basename may use the resolved root path as its name.
- All provider-relative paths must be normalized to `/` separators.
- The template-exclusion path must match the exact file under the root.
- Do not allow generated relative paths to escape the output root.

## Transactional output

Generation must be all-or-nothing from the caller's perspective.

1. Render every page in memory first.
2. Write every rendered page into a staging area outside the scanned folder.
3. Do not modify final `index.html` files unless every page rendered
   successfully.
4. Back up every existing destination `index.html` before commit.
5. Commit staged pages only after staging and backups succeed.
6. If commit fails:
   - restore every overwritten destination from its backup;
   - remove every destination that did not exist before the transaction;
   - report rollback failures instead of silently accepting partial output.
7. If staging or backup fails before commit, perform no final-output rollback
   unless an output file was actually modified.
8. Report the original error and any rollback or cleanup errors.
9. Clean up staging data on success and failure.
10. Use an OS temp directory for staging. If that temp directory is inside the
    scanned root, use a hidden sibling directory such as
    `.directory-index-<random-id>`.

Use a native `AggregateError` when one or more rollback or cleanup operations
add to the original failure. Aggregate errors should contain the original
error first, followed by rollback errors, followed by cleanup errors.
Do not silently leave newly created or overwritten partial output.

## Physical filesystem adapter

- Use `node:fs/promises` and directory entry metadata.
- Include hidden entries.
- Skip symbolic links and junction-like entries.
- Use platform-normalized absolute paths.
- Root containment checks must prevent template and output paths escaping the
  scanned root.
- Windows path comparisons must be case-insensitive.
- Linux/macOS path comparisons must be case-sensitive.

## Tests

Use xUnit-style coverage translated to Vitest behavior:

- root and nested directory generation;
- entry metadata, ordering, and relative links;
- hidden entries;
- generated-index exclusion;
- exact custom-template-file exclusion when under the root;
- empty directories;
- built-in template rendering;
- directories sorted before files and deterministic name ordering;
- custom Liquid template rendering;
- custom template parse failures;
- custom template rendering failures with no output call;
- symlink/reparse-point skipping in physical tests;
- staging failures;
- commit failures;
- restoration of overwritten indexes;
- removal of newly created indexes;
- rollback failures reported through `AggregateError`;
- cleanup failures reported;
- invalid folder and template arguments;
- CLI success and failure behavior;
- more than 1000 entries.

Core unit tests must use an in-memory provider and fake output writer.
Integration tests must use temporary physical directories.
Physical tests must run where the platform permits symlink creation and must
cleanly skip or report unsupported symlink setup.

There is no required percentage coverage threshold. Test names and scenarios
must cover behavioral requirements, not implementation constants.

## CLI integration

Add a small CLI integration test using a temporary physical directory:

- verify `--folder <path>` generates root and nested indexes;
- verify `--template <path>` renders custom content;
- verify missing `--folder` reports a usage/error message and exits `1`;
- verify missing folder paths fail clearly;
- verify invalid templates fail clearly;
- verify the physical adapter executes the symlink policy.

## Build and test commands

The TypeScript package must define standard npm scripts equivalent to:

```json
{
  "build": "tsc -p tsconfig.json",
  "test": "vitest run",
  "test:watch": "vitest",
  "package": "npm run build && npm pack"
}
```

Script names may vary but must provide build, test, and package operations.
No external network access is required for core rendering tests.

## CI and publishing

- Test on Linux, Windows, and macOS.
- Test with Node.js 20 and Node.js 22.
- Run build and tests on pull requests and pushes.
- Build and test before npm pack.
- Publish from a manual or approved GitHub Actions workflow.
- Publishing should be run from a release tag or explicit manual release input.
- Keep the C# solution independent of npm build/test output.
- Do not commit `dist`, `node_modules`, or local npm packs.
- Add appropriate npm ignore rules.

## Documentation

Include a TypeScript package README documenting:

- npm installation;
- `npx` usage;
- CLI options;
- LiquidJS template syntax and migration from Scriban;
- the Liquid data contract;
- library API usage;
- local build and test commands;
- npm packing and publishing commands;
- symlink and transaction behavior;
