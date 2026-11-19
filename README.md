# DirectoryIndexToHtml

[![NuGet version](https://img.shields.io/nuget/v/DirectoryIndexToHtml)](https://www.nuget.org/packages/DirectoryIndexToHtml)
[![NuGet downloads](https://img.shields.io/nuget/dt/DirectoryIndexToHtml)](https://www.nuget.org/packages/DirectoryIndexToHtml)

Generate self-contained `index.html` directory listings with the
`directory-index` .NET tool.

## Install as a .NET tool

Install the latest version from [NuGet.org](https://www.nuget.org/packages/DirectoryIndexToHtml):

```shell
dotnet tool install --global DirectoryIndexToHtml
```

Update an existing global installation with `dotnet tool update --global DirectoryIndexToHtml`.

Generate `index.html` in a directory and all its subdirectories:

```shell
directory-index --folder ./site
```

Use a custom Scriban template with `--template <path>`:

```shell
directory-index --folder ./site --template ./index.sbn
```

The tool requires the .NET 11 runtime.

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
