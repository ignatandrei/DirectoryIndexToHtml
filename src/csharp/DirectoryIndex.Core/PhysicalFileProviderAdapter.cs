using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Primitives;

namespace DirectoryIndex.Core;

public sealed class PhysicalFileProviderAdapter : IFileProvider, IDisposable
{
    private readonly string _root;
    private readonly PhysicalFileProvider _provider;

    public PhysicalFileProviderAdapter(string root)
    {
        _root = Path.GetFullPath(root);
        _provider = new PhysicalFileProvider(_root);
    }

    public IDirectoryContents GetDirectoryContents(string subpath)
    {
        var contents = _provider.GetDirectoryContents(subpath);
        if (!contents.Exists)
        {
            return contents;
        }

        var physicalDirectory = Path.GetFullPath(Path.Combine(_root, subpath.Replace('/', Path.DirectorySeparatorChar)));
        var visibleItems = contents.Where(item =>
        {
            if (!item.IsDirectory)
            {
                return true;
            }

            var itemPath = Path.Combine(physicalDirectory, item.Name);
            return (File.GetAttributes(itemPath) & FileAttributes.ReparsePoint) == 0;
        });

        return new FilteredDirectoryContents(visibleItems);
    }

    public IFileInfo GetFileInfo(string subpath) => _provider.GetFileInfo(subpath);

    public IChangeToken Watch(string filter) => _provider.Watch(filter);

    public void Dispose() => _provider.Dispose();

    private sealed class FilteredDirectoryContents(IEnumerable<IFileInfo> files) : IDirectoryContents
    {
        public bool Exists => true;
        public IEnumerator<IFileInfo> GetEnumerator() => files.GetEnumerator();
        System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() => GetEnumerator();
    }
}
