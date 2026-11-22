# From the Initial Commit to PR #1

I started by creating the complete core of the directory index generator. I added a .NET 11 CLI, core traversal and rendering logic, a Scriban default template, a physical filesystem adapter, and transactional staged output.

I designed the data contract for templates and covered it with xUnit and LightBDD tests. I also fixed large listings and hidden-file handling. By the first merge, I had a working generator that could create root and nested pages, skip reparse-point directories, use custom templates, and roll back failed commits.

I could run the CLI directly from the source tree and supply a Scriban layout:

```shell
dotnet run --project src/csharp/DirectoryIndex.Cli -- --folder ./site --template ./index.sbn
```

The package is available on NuGet: https://www.nuget.org/packages/DirectoryIndexToHtml
