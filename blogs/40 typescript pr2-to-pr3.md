# From PR #2 to PR #3: A TypeScript Package

I asked AI to study the existing C# implementation and help me bring its directory-index generation to TypeScript. I clarified the requirements through our discussion, then worked with AI to define the TypeScript specification and build an ESM npm package with both a reusable library API and an `npx` command. It generates an HTML index for each directory, supports LiquidJS templates, and stages output so existing pages can be restored if writing fails.

I also guided the CI and release setup: one GitHub Actions workflow builds and tests on Windows, macOS, and Linux with Node 20 and 22, then creates an npm package artifact. Manual releases use a version beginning with the Node major version and date (`20.YYYY.MMDD`).

I can try the package without installing it globally:

```shell
npx directory-index-to-html --folder ./site
```

I prepared the package for npm under the name `directory-index-to-html`.
