using Microsoft.AspNetCore.Mvc;
using TestProject.Models;
using TestProject.Services;

namespace TestProject.Controllers;

/// <summary>
/// Handles file-level operations: upload, download, delete, move, copy.
/// These are separated from Browse/Search because they represent 
/// mutations and transfers rather than queries.
/// </summary>
[ApiController]
[Route("api/files")]
public class FilesController : ControllerBase
{
    private readonly IFileSystemService _fileService;

    public FilesController(IFileSystemService fileService)
    {
        _fileService = fileService;
    }

    /// <summary>
    /// GET /api/files/download/{**path}
    /// 
    /// Streams a file to the client. Uses PhysicalFile for efficient 
    /// zero-copy streaming — ASP.NET Core handles range requests and 
    /// content-length automatically.
    /// </summary>
    [HttpGet("download/{**path}")]
    public IActionResult Download(string path)
    {
        try
        {
            var fullPath = _fileService.ResolveSafePath(path);

            if (!System.IO.File.Exists(fullPath))
                return NotFound(new { error = "File not found." });

            var contentType = GetContentType(fullPath);
            var fileName = Path.GetFileName(fullPath);

            return PhysicalFile(fullPath, contentType, fileName);
        }
        catch (UnauthorizedAccessException ex)
        {
            return StatusCode(403, new { error = ex.Message });
        }
    }

    /// <summary>
    /// POST /api/files/upload?path=/target/directory
    /// 
    /// Accepts multipart form uploads. Supports multiple files in a 
    /// single request. Each file is saved to the target directory.
    /// 
    /// *CHANGE* Now also reads an optional "relativePaths" form field.
    /// When uploading a folder, the browser provides each file's path 
    /// relative to the selected folder root (e.g., "subdir/file.txt").
    /// We pass this to SaveUploadedFile so it can auto-create the 
    /// intermediate directories and preserve the folder structure.
    /// </summary>
    [HttpPost("upload")]
    [RequestSizeLimit(100_000_000)] // 100MB limit
    public IActionResult Upload([FromQuery] string? path, IFormFileCollection files)
    {
        if (files == null || files.Count == 0)
            return BadRequest(new { error = "No files provided." });

        var uploadedPaths = new List<string>();

        // *CHANGE* Read the parallel array of relative paths from form data.
        // The client sends one "relativePaths" entry per file, in the same order.
        // For regular file uploads these will be empty/just the filename.
        // For folder uploads these contain the subfolder structure.
        var relativePaths = Request.Form["relativePaths"].ToArray();

        try
        {
            for (int i = 0; i < files.Count; i++)
            {
                var file = files[i];
                using var stream = file.OpenReadStream();

                // *CHANGE* Use the relative path if provided, otherwise fall back to the filename.
                // This preserves folder structure: "docs/readme.txt" creates a "docs" subdirectory.
                var fileName = (i < relativePaths.Length && !string.IsNullOrEmpty(relativePaths[i]))
                    ? relativePaths[i]
                    : file.FileName;

                var savedPath = _fileService.SaveUploadedFile(path ?? "/", stream, fileName);
                uploadedPaths.Add(savedPath);
            }

            return Ok(new { uploaded = uploadedPaths });
        }
        catch (DirectoryNotFoundException)
        {
            return NotFound(new { error = "Target directory not found." });
        }
        catch (UnauthorizedAccessException ex)
        {
            return StatusCode(403, new { error = ex.Message });
        }
    }

    // *CHANGE* New endpoint: creates an empty folder in the current directory.
    // POST /api/files/create-folder?path=/parent/dir
    // Body: { "folderName": "New Folder" }
    //
    // Separated from the upload endpoint because creating an empty folder
    // is a distinct operation — no file data is involved, just a name.
    [HttpPost("create-folder")]
    public IActionResult CreateFolder([FromQuery] string? path, [FromBody] CreateFolderRequest request)
    {
        if (string.IsNullOrWhiteSpace(request?.FolderName))
            return BadRequest(new { error = "Folder name is required." });

        try
        {
            var createdPath = _fileService.CreateFolder(path ?? "/", request.FolderName);
            return Ok(new { created = createdPath });
        }
        catch (DirectoryNotFoundException)
        {
            return NotFound(new { error = "Parent directory not found." });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { error = ex.Message });
        }
        catch (UnauthorizedAccessException ex)
        {
            return StatusCode(403, new { error = ex.Message });
        }
    }

    /// <summary>
    /// DELETE /api/files/{**path}
    /// 
    /// Deletes a file or folder (recursive for folders).
    /// </summary>
    [HttpDelete("{**path}")]
    public IActionResult Delete(string path)
    {
        try
        {
            _fileService.DeleteEntry(path);
            return Ok(new { deleted = path });
        }
        catch (FileNotFoundException)
        {
            return NotFound(new { error = "Entry not found." });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (UnauthorizedAccessException ex)
        {
            return StatusCode(403, new { error = ex.Message });
        }
    }

    /// <summary>
    /// POST /api/files/move
    /// Body: { sourcePath: "...", destinationPath: "..." }
    /// </summary>
    [HttpPost("move")]
    public IActionResult Move([FromBody] FileOperationRequest request)
    {
        try
        {
            _fileService.MoveEntry(request.SourcePath, request.DestinationPath!);
            return Ok(new { moved = request.SourcePath, to = request.DestinationPath });
        }
        catch (FileNotFoundException)
        {
            return NotFound(new { error = "Source not found." });
        }
        catch (UnauthorizedAccessException ex)
        {
            return StatusCode(403, new { error = ex.Message });
        }
    }

    /// <summary>
    /// POST /api/files/copy
    /// Body: { sourcePath: "...", destinationPath: "..." }
    /// </summary>
    [HttpPost("copy")]
    public IActionResult Copy([FromBody] FileOperationRequest request)
    {
        try
        {
            _fileService.CopyEntry(request.SourcePath, request.DestinationPath!);
            return Ok(new { copied = request.SourcePath, to = request.DestinationPath });
        }
        catch (FileNotFoundException)
        {
            return NotFound(new { error = "Source not found." });
        }
        catch (UnauthorizedAccessException ex)
        {
            return StatusCode(403, new { error = ex.Message });
        }
    }

    /// <summary>
    /// Basic MIME type lookup. In production you'd use a library or 
    /// the built-in FileExtensionContentTypeProvider, but keeping it 
    /// simple here to minimize dependencies.
    /// </summary>
    private static string GetContentType(string path)
    {
        var ext = Path.GetExtension(path).ToLowerInvariant();
        return ext switch
        {
            ".txt" => "text/plain",
            ".pdf" => "application/pdf",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            ".gif" => "image/gif",
            ".html" or ".htm" => "text/html",
            ".css" => "text/css",
            ".js" => "application/javascript",
            ".json" => "application/json",
            ".xml" => "application/xml",
            ".zip" => "application/zip",
            ".csv" => "text/csv",
            ".doc" => "application/msword",
            ".docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".xls" => "application/vnd.ms-excel",
            ".xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            _ => "application/octet-stream"
        };
    }
}
