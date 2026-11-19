# DirectoryIndexToHtml

## Install as a .NET tool

After downloading and extracting the `.nupkg` from the release's Actions
artifact, install it globally:

```shell
dotnet tool install --global --add-source <directory-containing-package> DirectoryIndexToHtml
```

Generate `index.html` in a directory and all its subdirectories:

```shell
directory-index --folder ./site
```

You can provide a custom Scriban template with `--template <path>`. The tool
requires the .NET 11 runtime.

## Package locally

From the repository root, create a tool package:

```shell
dotnet pack src/csharp/DirectoryIndex.Cli/DirectoryIndex.Cli.csproj --configuration Release --output ./artifacts
```

Install that package for the current user:

```shell
dotnet tool install --global --add-source ./artifacts DirectoryIndexToHtml
```

## Release artifact

Run the **Package .NET tool** workflow manually from the GitHub Actions tab to
build the tool package and upload it as an Actions artifact. Its version is
`11.yyyy.MMdd`, based on the package build date. The artifact is retained for
one day.
