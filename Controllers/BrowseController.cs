using Microsoft.AspNetCore.Mvc;
using TestProject.Services;

namespace TestProject.Controllers;

/// <summary>
/// Handles directory browsing. Uses a catch-all route parameter so 
/// the path can contain slashes (e.g., /api/browse/some/nested/folder).
/// </summary>
[ApiController]
[Route("api/browse")]
public class BrowseController : ControllerBase
{
    private readonly IFileSystemService _fileService;

    public BrowseController(IFileSystemService fileService)
    {
        _fileService = fileService;
    }

    /// <summary>
    /// GET /api/browse
    /// GET /api/browse/{**path}
    /// 
    /// Returns the contents of a directory with aggregate stats.
    /// The catch-all {**path} lets us accept paths like "folder/subfolder" naturally.
    /// </summary>
    [HttpGet("{**path}")]
    [HttpGet]
    public IActionResult Browse(string? path = null)
    {
        try
        {
            var result = _fileService.Browse(path ?? "/");
            return Ok(result);
        }
        catch (DirectoryNotFoundException)
        {
            return NotFound(new { error = "Directory not found." });
        }
        catch (UnauthorizedAccessException ex)
        {
            return StatusCode(403, new { error = ex.Message });
        }
    }
}
