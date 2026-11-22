# DirectoryIndexToHtml: My Directory Index Generator

I built DirectoryIndexToHtml as a .NET 11 tool that creates a self-contained `index.html` for every folder under a selected directory. I run it with `directory-index --folder ./site`; it can also use a custom Scriban template through `--template`.

I install it from NuGet as a global .NET tool:

```shell
dotnet tool install --global DirectoryIndexToHtml
```

For example, to publish browsable indexes for a static website, I would run:

```shell
directory-index --folder ./public
```

I can also apply a custom layout:

```shell
directory-index --folder ./public --template ./templates/index.txt
```

My generator exposes current-directory, breadcrumb, and immediate-child data to templates. It sorts directories first, includes hidden entries, skips existing index files and reparse-point directories, and renders each page transactionally.

I also packaged the application as a global .NET tool and added a manually triggered GitHub Actions workflow for producing versioned NuGet artifacts.

The package is available on NuGet: https://www.nuget.org/packages/DirectoryIndexToHtml
