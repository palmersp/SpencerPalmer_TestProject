# TestProject File Browser

A file and directory browsing single-page application built with ASP.NET Core 10 and vanilla JavaScript.

## Running

```bash
# Configure the home directory in appsettings.json, then:
dotnet run
```

Navigate to `https://localhost:5001` (or the port shown in console output).

## Architecture

### Server Side (C# / ASP.NET Core)

**Program.cs** — Registers services, enables static files, and maps controllers.

**Services/FileSystemService.cs** — Core business logic. All file system I/O is encapsulated here, separated from the HTTP layer. Key design decisions:

- **Path security**: `ResolveSafePath()` is the single security boundary. Every operation routes through it to prevent directory traversal attacks. It resolves the full path and validates it starts with the configured home directory.
- **Graceful error handling**: Enumerations catch `UnauthorizedAccessException` per-item rather than letting one inaccessible file kill the entire listing.
- **Lazy enumeration**: `EnumerateFileSystemInfos` over `GetFiles`/`GetDirectories` for better memory behavior on large directories.
- **Manual recursion for search**: We recurse ourselves rather than using `SearchOption.AllDirectories` so we can skip inaccessible directories gracefully and enforce a result cap.
- **Shallow directory sizes**: Directory sizes are computed from immediate children only — deep recursive sizing on browse would be a performance killer on large trees.

**Controllers/** — Thin controllers that delegate to the service. Three controllers map to three concerns:
- `BrowseController` — Directory listing (GET)
- `SearchController` — Recursive search (GET)  
- `FilesController` — Upload, download, delete, move, copy (POST/DELETE/GET)

### Client Side (Vanilla JS)

**js/utils.js** — Pure functions: formatting, icon mapping, DOM element creation helper (`el()`), debounce. No side effects, no state.

**js/api.js** — HTTP client module. All `fetch` calls are centralized here so error handling and URL construction happen in one place.

**js/app.js** — Application shell: routing, state management, rendering.

- **Hash-based routing**: The URL hash is the source of truth for navigation state. Format: `#/path` for browsing, `#search:term@/path` for search. Every view is deep-linkable and bookmarkable.
- **Single state object**: All UI state lives in one `state` object. The `render()` function reads this state and rebuilds the DOM. Simple, predictable, debuggable.
- **Full re-render**: On each state change, the entire UI is rebuilt. This is intentionally simple — for a few hundred entries it's fast enough, and it avoids the complexity of incremental DOM diffing. A production app with thousands of entries would use virtual scrolling.

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/browse/{path?}` | List directory contents |
| GET | `/api/search?q=term&path=/scope` | Search files/folders |
| GET | `/api/files/download/{path}` | Download a file |
| POST | `/api/files/upload?path=/target` | Upload files (multipart) |
| DELETE | `/api/files/{path}` | Delete file or folder |
| POST | `/api/files/move` | Move file/folder |
| POST | `/api/files/copy` | Copy file/folder |

## Trade-offs & Discussion Points

1. **Hash routing vs. History API**: Chose hash routing (`#/path`) because it works without any server-side route configuration. The History API would give cleaner URLs but requires the server to handle SPA fallback routing.

2. **Full re-render vs. incremental updates**: The full-rerender approach is simpler to reason about and sufficient for this scale. The `el()` helper keeps the rendering code readable without a template library.

3. **Synchronous directory size calculation**: Computing sizes during browse means the API response includes everything the UI needs in one call. The tradeoff is slightly slower responses for directories with many large files. An async/background approach could improve perceived performance.

4. **Search result cap (500)**: Prevents runaway searches on deep trees. A production implementation might use pagination or streaming results.

5. **No authentication**: Deliberately omitted per project scope, but the `ResolveSafePath` boundary prevents directory traversal regardless.
