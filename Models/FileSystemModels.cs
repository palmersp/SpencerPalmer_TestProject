namespace TestProject.Models;

/// <summary>
/// Represents a single file system entry (file or folder) in API responses.
/// </summary>
public class FileSystemEntry
{
    public string Name { get; set; } = string.Empty;
    public string Path { get; set; } = string.Empty;
    public bool IsDirectory { get; set; }
    public long Size { get; set; }
    public DateTime LastModified { get; set; }
    public string? Extension { get; set; }
}

/// <summary>
/// The response payload for a directory browse request.
/// Includes the listing plus aggregate counts/sizes for the current view.
/// </summary>
public class BrowseResponse
{
    public string CurrentPath { get; set; } = string.Empty;
    public string? ParentPath { get; set; }
    public List<FileSystemEntry> Entries { get; set; } = new();
    public int FolderCount { get; set; }
    public int FileCount { get; set; }
    public long TotalSize { get; set; }
}

/// <summary>
/// The response payload for a search request.
/// </summary>
public class SearchResponse
{
    public string SearchTerm { get; set; } = string.Empty;
    public string SearchRoot { get; set; } = string.Empty;
    public List<FileSystemEntry> Results { get; set; } = new();
    public int FolderCount { get; set; }
    public int FileCount { get; set; }
    public long TotalSize { get; set; }
}

/// <summary>
/// Request body for file/folder operations (move, copy, delete).
/// </summary>
public class FileOperationRequest
{
    public string SourcePath { get; set; } = string.Empty;
    public string? DestinationPath { get; set; }
}

// *CHANGE* New model: request body for the create-folder endpoint.
// Kept as a separate class rather than reusing FileOperationRequest 
// because the semantics are different — this only needs a name, not paths.
public class CreateFolderRequest
{
    public string FolderName { get; set; } = string.Empty;
}
