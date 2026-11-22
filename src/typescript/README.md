# directory-index-to-html

Generate a self-contained HTML directory index in a folder and every subfolder.

## Install

```shell
npm install --global directory-index-to-html
```

Or run without a permanent installation:

```shell
npx directory-index-to-html --folder ./site
```

## CLI

```text
directory-index --folder <path> [--template <path>]
```

- `--folder` is required.
- `--template` optionally supplies a custom LiquidJS template.

## LiquidJS templates

Custom templates use LiquidJS syntax, for example `{{ directory.name }}` and
`{% for entry in entries %}`. Scriban syntax is not compatible.

The template data is:

```text
directory.name
directory.path
entries[].name
entries[].path
entries[].is_directory
entries[].href
breadcrumbs[].name
breadcrumbs[].href
breadcrumbs[].is_current
```

Paths use `/`; names are URL escaped as appropriate for links. Interpolated
custom-template values are HTML escaped.

## Library API

```ts
import { generateDirectoryIndexes } from "directory-index-to-html";

const result = await generateDirectoryIndexes({
  folder: "./site",
  template: "./layout.liquid"
});

console.log(result.pageCount, result.pages);
```

The package also exports `DirectoryFileProvider`, `DirectoryOutputWriter`, and
their option/result types.

## Build and test

```shell
npm install
npm run build
npm test
npm run package
```

## Publishing

```shell
npm run package
npm publish
```

Generated pages are rendered in memory before commit. Existing `index.html`
files are staged and backed up transactionally, with rollback on commit failure.
Symlinks and reparse/junction-like entries are skipped.
