using TestProject.Models;

namespace TestProject.Services;

public interface IFileSystemService
{
    string HomeDirectory { get; }
    string ResolveSafePath(string relativePath);
    BrowseResponse Browse(string relativePath);
    SearchResponse Search(string searchTerm, string relativePath);
    FileSystemEntry GetEntryInfo(string fullPath);
    void DeleteEntry(string relativePath);
    void MoveEntry(string sourceRelative, string destRelative);
    void CopyEntry(string sourceRelative, string destRelative);
    string SaveUploadedFile(string relativePath, Stream content, string? fileName);
    // *CHANGE* New method: creates an empty directory at the given path
    string CreateFolder(string relativePath, string folderName);
}

/// <summary>
/// Encapsulates all file system operations. This is where path security,
/// directory traversal prevention, and the actual I/O logic live.
/// Keeping this out of the controller makes it testable and keeps the
/// controller thin.
/// </summary>
public class FileSystemService : IFileSystemService
{
    private readonly string _homeDirectory;

    public string HomeDirectory => _homeDirectory;

    public FileSystemService(IConfiguration configuration)
    {
        _homeDirectory = configuration["FileServer:HomeDirectory"] ?? "FileDirectory";
        _homeDirectory = Path.GetFullPath(_homeDirectory);
    }

    /// <summary>
    /// Resolves a user-provided relative path to a full path, ensuring it 
    /// stays within the home directory. This is the primary security boundary —
    /// every public method should route through here to prevent directory 
    /// traversal attacks (e.g., ../../etc/passwd).
    /// </summary>
    public string ResolveSafePath(string relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath) || relativePath == "/")
            return _homeDirectory;

        // Normalize separators and strip leading slash
        relativePath = relativePath.Replace('/', Path.DirectorySeparatorChar)
                                   .TrimStart(Path.DirectorySeparatorChar);

        var fullPath = Path.GetFullPath(Path.Combine(_homeDirectory, relativePath));

        // Security check: the resolved path must be at or below the home directory
        if (!fullPath.StartsWith(_homeDirectory, StringComparison.OrdinalIgnoreCase))
            throw new UnauthorizedAccessException("Access denied: path is outside the home directory.");

        return fullPath;
    }

    /// <summary>
    /// Lists the contents of a directory and computes aggregate stats 
    /// (file count, folder count, total size) for the current view.
    /// </summary>
    public BrowseResponse Browse(string relativePath)
    {
        var fullPath = ResolveSafePath(relativePath);

        if (!Directory.Exists(fullPath))
            throw new DirectoryNotFoundException($"Directory not found: {relativePath}");

        var dirInfo = new DirectoryInfo(fullPath);
        var entries = new List<FileSystemEntry>();

        // Enumerate subdirectories
        try
        {
            foreach (var dir in dirInfo.EnumerateDirectories())
            {
                // Skip system/hidden dirs that would cause access issues
                if (IsSystemOrHidden(dir.Attributes)) continue;

                entries.Add(new FileSystemEntry
                {
                    Name = dir.Name,
                    Path = GetRelativePath(dir.FullName),
                    IsDirectory = true,
                    Size = GetDirectorySizeSafe(dir),
                    LastModified = dir.LastWriteTimeUtc
                });
            }
        }
        catch (UnauthorizedAccessException) { /* skip inaccessible dirs */ }

        // Enumerate files
        try
        {
            foreach (var file in dirInfo.EnumerateFiles())
            {
                if (IsSystemOrHidden(file.Attributes)) continue;

                entries.Add(new FileSystemEntry
                {
                    Name = file.Name,
                    Path = GetRelativePath(file.FullName),
                    IsDirectory = false,
                    Size = file.Length,
                    LastModified = file.LastWriteTimeUtc,
                    Extension = file.Extension.TrimStart('.')
                });
            }
        }
        catch (UnauthorizedAccessException) { /* skip inaccessible files */ }

        var folders = entries.Where(e => e.IsDirectory).ToList();
        var files = entries.Where(e => !e.IsDirectory).ToList();

        return new BrowseResponse
        {
            CurrentPath = GetRelativePath(fullPath),
            ParentPath = fullPath == _homeDirectory ? null : GetRelativePath(Directory.GetParent(fullPath)!.FullName),
            Entries = entries.OrderByDescending(e => e.IsDirectory).ThenBy(e => e.Name).ToList(),
            FolderCount = folders.Count,
            FileCount = files.Count,
            TotalSize = files.Sum(f => f.Size)
        };
    }

    /// <summary>
    /// Recursively searches for files and folders matching a search term.
    /// Uses EnumerateFileSystemInfos for lazy evaluation — important for 
    /// performance on large directory trees since we avoid loading everything 
    /// into memory at once.
    /// </summary>
    public SearchResponse Search(string searchTerm, string relativePath)
    {
        var fullPath = ResolveSafePath(relativePath);

        if (!Directory.Exists(fullPath))
            throw new DirectoryNotFoundException($"Directory not found: {relativePath}");

        var results = new List<FileSystemEntry>();
        var searchPattern = $"*{searchTerm}*";

        SearchRecursive(new DirectoryInfo(fullPath), searchPattern, results, maxResults: 500);

        var folders = results.Where(e => e.IsDirectory).ToList();
        var files = results.Where(e => !e.IsDirectory).ToList();

        return new SearchResponse
        {
            SearchTerm = searchTerm,
            SearchRoot = GetRelativePath(fullPath),
            Results = results.OrderByDescending(e => e.IsDirectory).ThenBy(e => e.Name).ToList(),
            FolderCount = folders.Count,
            FileCount = files.Count,
            TotalSize = files.Sum(f => f.Size)
        };
    }

    /// <summary>
    /// Manual recursive search. We do this ourselves rather than using 
    /// SearchOption.AllDirectories so that we can gracefully skip 
    /// directories we don't have access to, rather than having the 
    /// entire enumeration throw.
    /// </summary>
    private void SearchRecursive(DirectoryInfo dir, string pattern, List<FileSystemEntry> results, int maxResults)
    {
        if (results.Count >= maxResults) return;

        try
        {
            foreach (var entry in dir.EnumerateFileSystemInfos(pattern))
            {
                if (results.Count >= maxResults) return;
                if (IsSystemOrHidden(entry.Attributes)) continue;

                results.Add(new FileSystemEntry
                {
                    Name = entry.Name,
                    Path = GetRelativePath(entry.FullName),
                    IsDirectory = entry is DirectoryInfo,
                    Size = entry is FileInfo fi ? fi.Length : 0,
                    LastModified = entry.LastWriteTimeUtc,
                    Extension = entry is FileInfo f ? f.Extension.TrimStart('.') : null
                });
            }

            // Recurse into subdirectories
            foreach (var subDir in dir.EnumerateDirectories())
            {
                if (results.Count >= maxResults) return;
                if (IsSystemOrHidden(subDir.Attributes)) continue;
                SearchRecursive(subDir, pattern, results, maxResults);
            }
        }
        catch (UnauthorizedAccessException) { /* skip inaccessible */ }
        catch (IOException) { /* skip I/O errors */ }
    }

    public FileSystemEntry GetEntryInfo(string fullPath)
    {
        if (Directory.Exists(fullPath))
        {
            var di = new DirectoryInfo(fullPath);
            return new FileSystemEntry
            {
                Name = di.Name,
                Path = GetRelativePath(di.FullName),
                IsDirectory = true,
                Size = GetDirectorySizeSafe(di),
                LastModified = di.LastWriteTimeUtc
            };
        }

        if (File.Exists(fullPath))
        {
            var fi = new FileInfo(fullPath);
            return new FileSystemEntry
            {
                Name = fi.Name,
                Path = GetRelativePath(fi.FullName),
                IsDirectory = false,
                Size = fi.Length,
                LastModified = fi.LastWriteTimeUtc,
                Extension = fi.Extension.TrimStart('.')
            };
        }

        throw new FileNotFoundException("Entry not found.");
    }

    public void DeleteEntry(string relativePath)
    {
        var fullPath = ResolveSafePath(relativePath);

        if (fullPath == _homeDirectory)
            throw new InvalidOperationException("Cannot delete the home directory.");

        if (Directory.Exists(fullPath))
            Directory.Delete(fullPath, recursive: true);
        else if (File.Exists(fullPath))
            File.Delete(fullPath);
        else
            throw new FileNotFoundException("Entry not found.");
    }

    public void MoveEntry(string sourceRelative, string destRelative)
    {
        var sourceFull = ResolveSafePath(sourceRelative);
        var destFull = ResolveSafePath(destRelative);

        if (Directory.Exists(sourceFull))
        {
            // If destination is an existing directory, move inside it
            if (Directory.Exists(destFull))
                destFull = Path.Combine(destFull, Path.GetFileName(sourceFull));

            Directory.Move(sourceFull, destFull);
        }
        else if (File.Exists(sourceFull))
        {
            if (Directory.Exists(destFull))
                destFull = Path.Combine(destFull, Path.GetFileName(sourceFull));

            File.Move(sourceFull, destFull, overwrite: false);
        }
        else
        {
            throw new FileNotFoundException("Source not found.");
        }
    }

    public void CopyEntry(string sourceRelative, string destRelative)
    {
        var sourceFull = ResolveSafePath(sourceRelative);
        var destFull = ResolveSafePath(destRelative);

        if (File.Exists(sourceFull))
        {
            if (Directory.Exists(destFull))
                destFull = Path.Combine(destFull, Path.GetFileName(sourceFull));

            File.Copy(sourceFull, destFull, overwrite: false);
        }
        else if (Directory.Exists(sourceFull))
        {
            if (Directory.Exists(destFull))
                destFull = Path.Combine(destFull, Path.GetFileName(sourceFull));

            CopyDirectoryRecursive(sourceFull, destFull);
        }
        else
        {
            throw new FileNotFoundException("Source not found.");
        }
    }

    public string SaveUploadedFile(string relativePath, Stream content, string? fileName)
    {
        var dirFullPath = ResolveSafePath(relativePath);

        if (!Directory.Exists(dirFullPath))
            throw new DirectoryNotFoundException("Upload target directory not found.");

        var filePath = Path.Combine(dirFullPath, fileName ?? "");

        // Ensure the resolved file path is still within bounds
        var resolvedFilePath = Path.GetFullPath(filePath);
        if (!resolvedFilePath.StartsWith(_homeDirectory, StringComparison.OrdinalIgnoreCase))
            throw new UnauthorizedAccessException("Invalid file name.");

        // *CHANGE* Auto-create intermediate directories for folder uploads.
        // When uploading an entire folder, the fileName may contain path
        // separators (e.g., "subfolder/deep/file.txt"). We need to ensure 
        // every parent directory in that chain exists before writing the file.
        var fileDir = Path.GetDirectoryName(resolvedFilePath)!;
        if (!Directory.Exists(fileDir))
        {
            // Validate the intermediate directory is also within bounds
            if (!fileDir.StartsWith(_homeDirectory, StringComparison.OrdinalIgnoreCase))
                throw new UnauthorizedAccessException("Invalid file path.");
            Directory.CreateDirectory(fileDir);
        }

        using var fs = new FileStream(resolvedFilePath, FileMode.Create, FileAccess.Write);
        content.CopyTo(fs);

        return GetRelativePath(resolvedFilePath);
    }

    // *CHANGE* New method: Creates an empty folder. Used by the "New Folder" UI feature.
    // Validates the folder name and target path are safe before creating.
    public string CreateFolder(string relativePath, string folderName)
    {
        var parentFullPath = ResolveSafePath(relativePath);

        if (!Directory.Exists(parentFullPath))
            throw new DirectoryNotFoundException("Parent directory not found.");

        // Reject folder names that contain path separators or other risky characters
        if (string.IsNullOrWhiteSpace(folderName))
            throw new ArgumentException("Folder name cannot be empty.");

        var invalidChars = Path.GetInvalidFileNameChars();
        if (folderName.Any(c => invalidChars.Contains(c)))
            throw new ArgumentException("Folder name contains invalid characters.");

        var newFolderPath = Path.Combine(parentFullPath, folderName);
        var resolvedPath = Path.GetFullPath(newFolderPath);

        // Security: ensure we're still within the home directory
        if (!resolvedPath.StartsWith(_homeDirectory, StringComparison.OrdinalIgnoreCase))
            throw new UnauthorizedAccessException("Invalid folder name.");

        if (Directory.Exists(resolvedPath))
            throw new InvalidOperationException($"Folder '{folderName}' already exists.");

        Directory.CreateDirectory(resolvedPath);
        return GetRelativePath(resolvedPath);
    }

    // ---- Private helpers ----

    private string GetRelativePath(string fullPath)
    {
        if (fullPath == _homeDirectory) return "/";

        var relative = fullPath[_homeDirectory.Length..]
            .Replace(Path.DirectorySeparatorChar, '/');

        return relative.StartsWith('/') ? relative : "/" + relative;
    }

    private static bool IsSystemOrHidden(FileAttributes attrs)
    {
        return (attrs & FileAttributes.System) != 0;
    }

    /// <summary>
    /// Gets immediate-child file sizes for a directory. We intentionally 
    /// don't recurse here for performance — computing deep sizes on every 
    /// browse would be too slow on large trees. The UI can request deep 
    /// size on demand if needed.
    /// </summary>
    private static long GetDirectorySizeSafe(DirectoryInfo dir)
    {
        try
        {
            return dir.EnumerateFiles().Sum(f => f.Length);
        }
        catch
        {
            return 0;
        }
    }

    private static void CopyDirectoryRecursive(string source, string destination)
    {
        Directory.CreateDirectory(destination);

        foreach (var file in Directory.GetFiles(source))
        {
            File.Copy(file, Path.Combine(destination, Path.GetFileName(file)));
        }

        foreach (var dir in Directory.GetDirectories(source))
        {
            CopyDirectoryRecursive(dir, Path.Combine(destination, Path.GetFileName(dir)));
        }
    }
}
