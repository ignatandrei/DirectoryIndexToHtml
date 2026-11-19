using System.Runtime.ExceptionServices;
using Microsoft.Extensions.FileProviders;
using Scriban;
using Scriban.Runtime;

namespace DirectoryIndex.Core;

public interface IOutputWriter
{
    Task WriteAllAsync(
        string outputRoot,
        IReadOnlyDictionary<string, string> pages,
        CancellationToken cancellationToken = default);
}

public sealed class DirectoryIndexGenerator
{
    private readonly IFileProvider _fileProvider;
    private readonly IOutputWriter _outputWriter;
    private readonly Template _template;
    private readonly string? _excludedTemplatePath;

    public DirectoryIndexGenerator(
        IFileProvider fileProvider,
        IOutputWriter outputWriter,
        string templateSource,
        string templateName ,
        string? excludedTemplatePath = null)
    {
        _fileProvider = fileProvider;
        _outputWriter = outputWriter;
        _template = DirectoryIndexTemplates.Parse(templateSource, templateName);
        _excludedTemplatePath = NormalizeProviderPath(excludedTemplatePath);
    }

    public async Task GenerateAsync(
        string outputRoot,
        string rootName,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(outputRoot);
        ArgumentException.ThrowIfNullOrWhiteSpace(rootName);

        var pages = new Dictionary<string, string>(StringComparer.Ordinal);
        await RenderDirectoryAsync("", rootName, [], pages, cancellationToken);
        await _outputWriter.WriteAllAsync(outputRoot, pages, cancellationToken);
    }

    private async Task RenderDirectoryAsync(
        string directoryPath,
        string directoryName,
        IReadOnlyList<string> ancestors,
        IDictionary<string, string> pages,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var contents = _fileProvider.GetDirectoryContents(directoryPath);
        if (!contents.Exists)
        {
            throw new DirectoryNotFoundException($"Directory '{directoryPath}' does not exist in the file provider.");
        }

        var entries = new List<Dictionary<string, object?>>();
        var childDirectories = new List<(string Path, string Name)>();
        foreach (var item in contents)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (item.Name.Equals("index.html", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var entryPath = JoinProviderPath(directoryPath, item.Name);
            if (_excludedTemplatePath is not null && ProviderPathsEqual(entryPath, _excludedTemplatePath))
            {
                continue;
            }

            var escapedName = EscapePathSegment(item.Name);
            var isDirectory = item.IsDirectory;
            entries.Add(new Dictionary<string, object?>
            {
                ["name"] = item.Name,
                ["path"] = entryPath,
                ["is_directory"] = isDirectory,
                ["href"] = isDirectory ? $"{escapedName}/index.html" : escapedName
            });

            if (isDirectory)
            {
                childDirectories.Add((entryPath, item.Name));
            }
        }

        entries.Sort(EntryComparer.Instance);
        var directoryModel = new Dictionary<string, object?>
        {
            ["name"] = directoryName,
            ["path"] = directoryPath
        };
        var breadcrumbs = CreateBreadcrumbs(ancestors, directoryName);
        var model = new Dictionary<string, object?>
        {
            ["directory"] = directoryModel,
            ["entries"] = entries,
            ["breadcrumbs"] = breadcrumbs
        };

        var context = new TemplateContext
        {
            LoopLimit = Math.Max(entries.Count, breadcrumbs.Count)
        };
        context.PushGlobal(ScriptObject.From(model));
        var page = _template.Render(context);
        var outputPath = directoryPath.Length == 0 ? "index.html" : $"{directoryPath}/index.html";
        pages.Add(outputPath, page);

        var nextAncestors = ancestors.Concat([directoryName]).ToArray();
        foreach (var (childPath, childName) in childDirectories)
        {
            await RenderDirectoryAsync(childPath, childName, nextAncestors, pages, cancellationToken);
        }
    }

    private static List<Dictionary<string, object?>> CreateBreadcrumbs(
        IReadOnlyList<string> ancestors,
        string currentName)
    {
        var names = ancestors.Append(currentName).ToArray();
        var currentDepth = names.Length - 1;
        var breadcrumbs = new List<Dictionary<string, object?>>(names.Length);
        for (var index = 0; index < names.Length; index++)
        {
            var upLevels = currentDepth - index;
            var href = string.Join('/', Enumerable.Repeat("..", upLevels).Append("index.html"));
            breadcrumbs.Add(new Dictionary<string, object?>
            {
                ["name"] = names[index],
                ["href"] = href,
                ["is_current"] = index == currentDepth
            });
        }

        return breadcrumbs;
    }

    private static string JoinProviderPath(string parent, string name) =>
        parent.Length == 0 ? name : $"{parent}/{name}";

    private static string NormalizeProviderPath(string? path) =>
        path?.Replace('\\', '/').Trim('/') ?? "";

    private static bool ProviderPathsEqual(string left, string right) =>
        string.Equals(
            left,
            right,
            OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);

    private static string EscapePathSegment(string segment) => Uri.EscapeDataString(segment);

    private sealed class EntryComparer : IComparer<Dictionary<string, object?>>
    {
        public static EntryComparer Instance { get; } = new();

        public int Compare(Dictionary<string, object?>? left, Dictionary<string, object?>? right)
        {
            if (ReferenceEquals(left, right))
            {
                return 0;
            }

            if (left is null)
            {
                return -1;
            }

            if (right is null)
            {
                return 1;
            }

            var leftIsDirectory = (bool)left["is_directory"]!;
            var rightIsDirectory = (bool)right["is_directory"]!;
            var directoryComparison = rightIsDirectory.CompareTo(leftIsDirectory);
            if (directoryComparison != 0)
            {
                return directoryComparison;
            }

            var leftName = (string)left["name"]!;
            var rightName = (string)right["name"]!;
            var caseInsensitive = StringComparer.OrdinalIgnoreCase.Compare(leftName, rightName);
            return caseInsensitive != 0
                ? caseInsensitive
                : StringComparer.Ordinal.Compare(leftName, rightName);
        }
    }
}

public static class DirectoryIndexTemplates
{
    public const string Default = """
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>{{ directory.name | html.escape }}</title>
        </head>
        <body>
          <nav aria-label="Breadcrumb">
            {{ for crumb in breadcrumbs }}
              {{ if crumb.is_current }}<span aria-current="page">{{ crumb.name | html.escape }}</span>{{ else }}<a href="{{ crumb.href | html.escape }}">{{ crumb.name | html.escape }}</a>{{ end }}
              {{ if !for.last }} / {{ end }}
            {{ end }}
          </nav>
          <main>
            <h1>{{ directory.name | html.escape }}</h1>
            {{ if entries.size == 0 }}
              <p>No files or folders</p>
            {{ else }}
              <ul>
              {{ for entry in entries }}
                <li><a href="{{ entry.href | html.escape }}">{{ entry.name | html.escape }}</a>{{ if entry.is_directory }}{{ end }}</li>
              {{ end }}
              </ul>
            {{ end }}
          </main>
        </body>
        </html>
        """;

    public static Template Parse(string source, string sourceName = "template")
    {
        var template = Template.Parse(source, sourceName);
        if (template.HasErrors)
        {
            var messages = string.Join(Environment.NewLine, template.Messages.Select(message => message.ToString()));
            throw new FormatException($"Template '{sourceName}' has errors:{Environment.NewLine}{messages}");
        }

        return template;
    }
}
