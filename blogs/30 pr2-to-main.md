# From PR #2 to the Latest Commit

After packaging, I improved the release workflow and documentation. I changed the package workflow to manual dispatch, so it only creates an artifact when I trigger it.

I clarified installation and usage in the README, including global install and update commands, the `--template` option, and the .NET 11 requirement. I also documented the package build command and the date-based tool version format.

The workflow is manually triggered and derives a date-based package version:

```yaml
on:
  workflow_dispatch:
```

```powershell
$version = "11.$(Get-Date -Format 'yyyy.MMdd')"
```

The package is available on NuGet: https://www.nuget.org/packages/DirectoryIndexToHtml
