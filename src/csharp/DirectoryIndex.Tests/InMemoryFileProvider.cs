using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Primitives;

namespace DirectoryIndex.Tests;

internal sealed class TestFileProvider : IFileProvider
{
    private readonly Dictionary<string, List<IFileInfo>> _directories = new(StringComparer.Ordinal);

    public TestFileProvider()
    {
        _directories[""] = [];
    }

    public TestFileProvider AddDirectory(string path)
    {
        var normalized = Normalize(path);
        if (normalized.Length == 0)
        {
            return this;
        }

        var parent = Parent(normalized);
        var name = normalized[(normalized.LastIndexOf('/') + 1)..];
        AddDirectory(parent);
        if (!_directories.ContainsKey(normalized))
        {
            _directories[normalized] = [];
            _directories[parent].Add(new MemoryFileInfo(name, true, []));
        }

        return this;
    }

    public TestFileProvider AddFile(string path, string content = "")
    {
        var normalized = Normalize(path);
        var parent = Parent(normalized);
        AddDirectory(parent);
        var name = normalized[(normalized.LastIndexOf('/') + 1)..];
        _directories[parent].RemoveAll(file => file.Name == name);
        _directories[parent].Add(new MemoryFileInfo(name, false, System.Text.Encoding.UTF8.GetBytes(content)));
        return this;
    }

    public IDirectoryContents GetDirectoryContents(string subpath)
    {
        var normalized = Normalize(subpath);
        return _directories.TryGetValue(normalized, out var files)
            ? new MemoryDirectoryContents(files)
            : NotFoundDirectoryContents.Singleton;
    }

    public IFileInfo GetFileInfo(string subpath)
    {
        var normalized = Normalize(subpath);
        var parent = Parent(normalized);
        var name = normalized[(normalized.LastIndexOf('/') + 1)..];
        return _directories.TryGetValue(parent, out var files)
            ? files.FirstOrDefault(file => file.Name == name) ?? new NotFoundFileInfo(name)
            : new NotFoundFileInfo(name);
    }

    public IChangeToken Watch(string filter) => NeverChangeToken.Instance;

    private static string Normalize(string path) => path.Replace('\\', '/').Trim('/');
    private static string Parent(string path) => path.Contains('/') ? path[..path.LastIndexOf('/')] : "";

    private sealed class MemoryDirectoryContents(IReadOnlyList<IFileInfo> files) : IDirectoryContents
    {
        public bool Exists => true;
        public IEnumerator<IFileInfo> GetEnumerator() => files.GetEnumerator();
        System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() => GetEnumerator();
    }

    private sealed class MemoryFileInfo(string name, bool isDirectory, byte[] content) : IFileInfo
    {
        public bool Exists => true;
        public long Length => isDirectory ? -1 : content.Length;
        public string? PhysicalPath => null;
        public string Name => name;
        public DateTimeOffset LastModified => DateTimeOffset.UnixEpoch;
        public bool IsDirectory => isDirectory;
        public Stream CreateReadStream() => new MemoryStream(content, writable: false);
    }
}

internal sealed class NeverChangeToken : IChangeToken
{
    public static NeverChangeToken Instance { get; } = new();
    public bool HasChanged => false;
    public bool ActiveChangeCallbacks => false;
    public IDisposable RegisterChangeCallback(Action<object?> callback, object? state) => EmptyDisposable.Instance;

    private sealed class EmptyDisposable : IDisposable
    {
        public static EmptyDisposable Instance { get; } = new();
        public void Dispose() { }
    }
}

internal sealed class RecordingOutputWriter : DirectoryIndex.Core.IOutputWriter
{
    public Dictionary<string, string> Pages { get; } = new(StringComparer.Ordinal);
    public Exception? Failure { get; set; }
    public bool Called { get; private set; }

    public Task WriteAllAsync(
        string outputRoot,
        IReadOnlyDictionary<string, string> pages,
        CancellationToken cancellationToken = default)
    {
        Called = true;
        if (Failure is not null)
        {
            throw Failure;
        }

        foreach (var (path, content) in pages)
        {
            Pages[path] = content;
        }

        return Task.CompletedTask;
    }
}
