using System.CommandLine;
using DirectoryIndex.Core;

namespace DirectoryIndex.Cli;

public static class Program
{
    public static Task<int> Main(string[] args)
    {
        return RunAsync(args, Console.Out, Console.Error);
    }
    public static async Task<int> RunAsync(string[] args, TextWriter output, TextWriter error)
    {
        var folderOption = new Option<string>("--folder")
        {
            Description = "Root directory to index.",
            Required = true
        };
        var templateOption = new Option<string?>("--template")
        {
            Description = "Optional Scriban template file."
        };
        var command = new RootCommand("Generate an index.html in a directory and each subdirectory.");
        command.Options.Add(folderOption);
        command.Options.Add(templateOption);

        command.SetAction(async parseResult =>
        {
            var folderArgument = parseResult.GetValue(folderOption);
            var templateArgument = parseResult.GetValue(templateOption);
            try
            {
                if (string.IsNullOrWhiteSpace(folderArgument))
                {
                    throw new ArgumentException("The --folder path cannot be empty.");
                }

                var root = Path.GetFullPath(folderArgument);
                if (!Directory.Exists(root))
                {
                    throw new DirectoryNotFoundException($"Folder '{root}' does not exist.");
                }

                var templateSource = templateArgument is null
                    ? DirectoryIndexTemplates.Default
                    : await File.ReadAllTextAsync(Path.GetFullPath(templateArgument));
                var excludedTemplatePath = templateArgument is null
                    ? null
                    : GetRelativePathIfContained(root, Path.GetFullPath(templateArgument));

                using var provider = new PhysicalFileProviderAdapter(root);
                var generator = new DirectoryIndexGenerator(
                    provider,
                    new TransactionalFileOutputWriter(),
                    templateSource,
                    templateArgument ?? "built-in default",
                    excludedTemplatePath);
                var rootName = new DirectoryInfo(root).Name;
                if (rootName.Length == 0)
                {
                    rootName = root;
                }

                await generator.GenerateAsync(root, rootName);
                await output.WriteLineAsync($"Generated indexes under '{root}'.");
                return 0;
            }
            catch (Exception exception)
            {
                await error.WriteLineAsync($"Error: {exception.Message}");
                return 1;
            }
        });

        var parseResult = command.Parse(args);
        if (parseResult.Errors.Count > 0)
        {
            foreach (var parseError in parseResult.Errors)
            {
                await error.WriteLineAsync(parseError.Message);
            }

            return 1;
        }

        return await parseResult.InvokeAsync();
    }

    private static string? GetRelativePathIfContained(string root, string candidate)
    {
        var relative = Path.GetRelativePath(root, candidate);
        if (Path.IsPathRooted(relative) ||
            relative == ".." ||
            relative.StartsWith($"..{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
        {
            return null;
        }

        return relative.Replace(Path.DirectorySeparatorChar, '/');
    }
}
