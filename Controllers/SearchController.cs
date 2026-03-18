using Microsoft.AspNetCore.Mvc;
using TestProject.Services;

namespace TestProject.Controllers;

/// <summary>
/// Handles recursive file/folder search within a given path scope.
/// </summary>
[ApiController]
[Route("api/search")]
public class SearchController : ControllerBase
{
    private readonly IFileSystemService _fileService;

    public SearchController(IFileSystemService fileService)
    {
        _fileService = fileService;
    }

    /// <summary>
    /// GET /api/search?q=term&path=/optional/scope
    /// 
    /// Searches recursively from the given path (defaults to root).
    /// The 'q' parameter is the search term; we do a wildcard match 
    /// on file/folder names.
    /// </summary>
    [HttpGet]
    public IActionResult Search([FromQuery] string q, [FromQuery] string? path = null)
    {
        if (string.IsNullOrWhiteSpace(q))
            return BadRequest(new { error = "Search query 'q' is required." });

        try
        {
            var result = _fileService.Search(q, path ?? "/");
            return Ok(result);
        }
        catch (DirectoryNotFoundException)
        {
            return NotFound(new { error = "Search root directory not found." });
        }
        catch (UnauthorizedAccessException ex)
        {
            return StatusCode(403, new { error = ex.Message });
        }
    }
}
