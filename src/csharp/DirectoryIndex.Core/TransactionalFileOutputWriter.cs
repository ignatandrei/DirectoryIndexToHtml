using System.Runtime.ExceptionServices;

namespace DirectoryIndex.Core;

public sealed class TransactionalFileOutputWriter : IOutputWriter
{
    private readonly IOutputFileSystem _fileSystem;

    public TransactionalFileOutputWriter() : this(new PhysicalOutputFileSystem())
    {
    }

    internal TransactionalFileOutputWriter(IOutputFileSystem fileSystem)
    {
        _fileSystem = fileSystem;
    }

    public async Task WriteAllAsync(
        string outputRoot,
        IReadOnlyDictionary<string, string> pages,
        CancellationToken cancellationToken = default)
    {
        var root = Path.GetFullPath(outputRoot);
        var stagingRoot = CreateStagingRoot(root);
        var stagedPages = Path.Combine(stagingRoot, "staged");
        var backups = Path.Combine(stagingRoot, "backups");
        var pathComparer = OperatingSystem.IsWindows() ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal;
        var originals = new Dictionary<string, bool>(pathComparer);
        Exception? failure = null;
        var rollbackErrors = new List<Exception>();
        var cleanupErrors = new List<Exception>();
        var commitStarted = false;

        try
        {
            _fileSystem.CreateDirectory(stagedPages);
            _fileSystem.CreateDirectory(backups);

            foreach (var (relativePath, content) in pages)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var stagedPath = ResolveWithin(stagedPages, relativePath);
                _fileSystem.CreateDirectory(Path.GetDirectoryName(stagedPath)!);
                await _fileSystem.WriteAllTextAsync(stagedPath, content, cancellationToken);
            }

            foreach (var relativePath in pages.Keys)
            {
                var destination = ResolveWithin(root, relativePath);
                var exists = _fileSystem.FileExists(destination);
                originals[destination] = exists;
                if (exists)
                {
                    var backupPath = ResolveWithin(backups, relativePath);
                    _fileSystem.CreateDirectory(Path.GetDirectoryName(backupPath)!);
                    _fileSystem.CopyFile(destination, backupPath, overwrite: true);
                }
            }

            commitStarted = true;
            foreach (var relativePath in pages.Keys)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var stagedPath = ResolveWithin(stagedPages, relativePath);
                var destination = ResolveWithin(root, relativePath);
                _fileSystem.CreateDirectory(Path.GetDirectoryName(destination)!);
                _fileSystem.CopyFile(stagedPath, destination, overwrite: true);
            }
        }
        catch (Exception exception)
        {
            failure = exception;
            if (commitStarted)
            {
                foreach (var (destination, existed) in originals)
                {
                    try
                    {
                        if (existed)
                        {
                            var relativePath = Path.GetRelativePath(root, destination);
                            var backupPath = ResolveWithin(backups, relativePath);
                            _fileSystem.CopyFile(backupPath, destination, overwrite: true);
                        }
                        else if (_fileSystem.FileExists(destination))
                        {
                            _fileSystem.DeleteFile(destination);
                        }
                    }
                    catch (Exception rollbackError)
                    {
                        rollbackErrors.Add(new IOException($"Failed to roll back '{destination}'.", rollbackError));
                    }
                }
            }
        }

        try
        {
            if (_fileSystem.DirectoryExists(stagingRoot))
            {
                _fileSystem.DeleteDirectory(stagingRoot, recursive: true);
            }
        }
        catch (Exception cleanupError)
        {
            cleanupErrors.Add(new IOException($"Failed to clean staging directory '{stagingRoot}'.", cleanupError));
        }

        var errors = new List<Exception>();
        if (failure is not null)
        {
            errors.Add(failure);
        }

        errors.AddRange(rollbackErrors);
        errors.AddRange(cleanupErrors);
        if (errors.Count == 1)
        {
            ExceptionDispatchInfo.Capture(errors[0]).Throw();
        }

        if (errors.Count > 1)
        {
            throw new AggregateException(
                "Output generation failed; one or more rollback or cleanup operations also failed.",
                errors);
        }
    }

    private static string CreateStagingRoot(string outputRoot)
    {
        var tempRoot = Path.GetFullPath(Path.GetTempPath());
        if (!IsSameOrChildPath(outputRoot, tempRoot))
        {
            return Path.Combine(tempRoot, $"directory-index-{Guid.NewGuid():N}");
        }

        var parent = Directory.GetParent(outputRoot)?.FullName;
        if (parent is null || IsSameOrChildPath(outputRoot, parent))
        {
            throw new IOException(
                $"No temporary staging location outside the scanned folder '{outputRoot}' is available.");
        }

        return Path.Combine(parent, $".directory-index-{Guid.NewGuid():N}");
    }

    internal interface IOutputFileSystem
    {
        bool FileExists(string path);
        bool DirectoryExists(string path);
        void CreateDirectory(string path);
        Task WriteAllTextAsync(string path, string content, CancellationToken cancellationToken);
        void CopyFile(string source, string destination, bool overwrite);
        void DeleteFile(string path);
        void DeleteDirectory(string path, bool recursive);
    }

    internal sealed class PhysicalOutputFileSystem : IOutputFileSystem
    {
        public bool FileExists(string path) => File.Exists(path);
        public bool DirectoryExists(string path) => Directory.Exists(path);
        public void CreateDirectory(string path) => Directory.CreateDirectory(path);
        public Task WriteAllTextAsync(string path, string content, CancellationToken cancellationToken) =>
            File.WriteAllTextAsync(path, content, cancellationToken);
        public void CopyFile(string source, string destination, bool overwrite) =>
            File.Copy(source, destination, overwrite);
        public void DeleteFile(string path) => File.Delete(path);
        public void DeleteDirectory(string path, bool recursive) => Directory.Delete(path, recursive);
    }

    private static bool IsSameOrChildPath(string parent, string candidate)
    {
        var relative = Path.GetRelativePath(parent, candidate);
        return relative == "." ||
               (!Path.IsPathRooted(relative) &&
                relative != ".." &&
                !relative.StartsWith($"..{Path.DirectorySeparatorChar}", StringComparison.Ordinal));
    }

    private static string ResolveWithin(string root, string relativePath)
    {
        var normalized = relativePath.Replace('/', Path.DirectorySeparatorChar);
        var fullPath = Path.GetFullPath(Path.Combine(root, normalized));
        if (!IsSameOrChildPath(root, fullPath))
        {
            throw new IOException($"Output path '{relativePath}' escapes its root.");
        }

        return fullPath;
    }
}
