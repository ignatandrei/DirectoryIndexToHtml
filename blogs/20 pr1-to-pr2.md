# From PR #1 to PR #2

After the initial implementation, I turned the CLI into a distributable .NET global tool. I configured `DirectoryIndexToHtml` as the package ID and `directory-index` as the command.

I added a GitHub Actions workflow that installs .NET 11, packs the CLI as a NuGet tool, and uploads the package as a short-lived Actions artifact. This made the project easier to build and distribute, not just run from source.

These project settings make the package installable as a .NET tool named `directory-index`:

```xml
<PackAsTool>true</PackAsTool>
<ToolCommandName>directory-index</ToolCommandName>
<PackageId>DirectoryIndexToHtml</PackageId>
```

The package is available on NuGet: https://www.nuget.org/packages/DirectoryIndexToHtml
