# Directory Index Generator Specification

## Purpose

Create a .NET 11 console application that generates an `index.html` in a
specified directory and every subdirectory. Each page is rendered from either
a user-provided Scriban template or a built-in default template.

## Command-line interface

Use `System.CommandLine`.

```text
directory-index --folder <path> [--template <path>]
```

- `--folder` is required and identifies the root directory to index.
- `--template` is optional. When provided, load and parse that Scriban template
  once before traversing the directory tree. When omitted, use the built-in
  template.
- Invalid arguments, paths, templates, or filesystem operations must produce a
  clear error and a nonzero exit code.

## Generation behavior

- Generate `index.html` in the root directory and each subdirectory.
- Enumerate immediate children for each page, then recurse into child
  directories.
- Include hidden entries.
- Exclude generated `index.html` files from listings.
- If the template file is under the scanned root, exclude that exact file from
  listings.
- Do not recurse into entries marked as reparse points by the physical
  filesystem adapter.
- Overwrite existing `index.html` files when generation succeeds.
- Treat the supplied local template as trusted input, but expose only listing
  data to it; do not expose application services or custom host functions.

## Scriban data contract

Expose lower-snake-case variables and properties:

- `directory`
  - `name`: current directory name.
  - `path`: path relative to the scanned root, using `/`; empty for the root.
- `entries`: immediate children, each with:
  - `name`: entry name.
  - `path`: path relative to the scanned root, using `/`.
  - `is_directory`: whether the entry is a directory.
  - `href`: URL-escaped path relative to the current page. Files link to the
    file; directories link to the child directory's `index.html`.
- `breadcrumbs`: root-to-current path, each with:
  - `name`: breadcrumb label.
  - `href`: URL-escaped relative link to that ancestor's generated index.
  - `is_current`: whether this is the current directory. The current crumb is
    plain text rather than a link.

The template controls the HTML and layout when a custom template is used.

## Built-in default template

The built-in template must produce self-contained HTML without external assets.
It must:

1. Show breadcrumbs at the top.
2. Show the current directory heading.
3. List directories before files, with each group sorted alphabetically by
   name, case-insensitively with a deterministic tie-break.
4. Show a short “No files or folders” message when the directory is empty.

Directory and file links must use the `href` values supplied in the data model.

## Architecture

- The CLI uses `PhysicalFileProvider` for filesystem input.
- The core traversal/rendering logic consumes `IFileProvider` and `IFileInfo`.
- Put output writing behind an injectable abstraction so generation can be
  tested without writing to the source tree.
- Keep filesystem-specific reparse-point checks in the physical filesystem
  adapter.

## Transactional output

Generation must be all-or-nothing:

1. Render every page into a temporary staging area outside the scanned folder.
2. Do not modify final output files unless all pages render successfully.
3. Commit staged pages only after successful rendering.
4. If commit fails, remove newly created indexes and restore overwritten
   indexes.
5. Report the original error and any rollback errors. Do not silently leave a
   partial result.
6. Clean up staging data on success or failure.

## Tests

Use xUnit. Unit tests should use an in-memory `IFileProvider` and a fake output
writer. Include coverage for:

- Root and nested directory generation.
- Entry metadata, ordering, and relative links.
- Hidden entries, generated-index exclusion, and exclusion of the template file
  when it is under the root.
- Empty directories and built-in template rendering.
- Custom template rendering and parse failures.
- Reparse-point skipping in physical filesystem tests.
- Errors during rendering and commit, including restoration of overwritten
  indexes and removal of newly created ones.
- Rollback failures being reported.

Add a small CLI integration test using a temporary physical directory to verify
argument handling and the physical filesystem adapter.

## Test file-provider dependency

Evaluate `Mirality.FileProviders.InMemory` 6.2.1 as a test-only dependency. It
targets .NET Standard 2.0 and should be consumable by .NET 11, but its last
release was in 2023 and it may produce `Microsoft.Extensions.*` version
warnings. Verify nested `IDirectoryContents` behavior with a focused test. Keep
a small local fake implementation as a fallback if compatibility or
maintenance concerns arise.
