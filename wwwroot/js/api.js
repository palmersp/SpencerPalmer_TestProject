/**
 * api.js — Thin HTTP client for the file browser API.
 * 
 * Design decision: All API calls go through this module so that 
 * error handling, base URL changes, and auth headers (if needed later)
 * are centralized in one place.
 */
const Api = (() => {

    /**
     * Wraps fetch with standard error handling. Returns parsed JSON 
     * or throws an error with the server's error message.
     */
    async function request(url, options = {}) {
        try {
            const response = await fetch(url, options);

            if (!response.ok) {
                const errorBody = await response.json().catch(() => null);
                throw new Error(errorBody?.error || `HTTP ${response.status}: ${response.statusText}`);
            }

            // DELETE might return empty body
            const text = await response.text();
            return text ? JSON.parse(text) : null;
        } catch (err) {
            if (err instanceof TypeError) {
                // Network error
                throw new Error('Network error — is the server running?');
            }
            throw err;
        }
    }

    /**
     * Fetches the contents of a directory.
     * @param {string} path - Relative path, e.g. "/" or "/docs/reports"
     * @returns {Promise<BrowseResponse>}
     */
    async function browse(path = '/') {
        // Strip leading slash for the URL — the API route handles it
        const cleanPath = path.replace(/^\//, '');
        const url = cleanPath ? `/api/browse/${cleanPath}` : '/api/browse';
        return request(url);
    }

    /**
     * Searches for files/folders matching a term.
     * @param {string} query - Search term
     * @param {string} path - Root path to search from
     * @returns {Promise<SearchResponse>}
     */
    async function search(query, path = '/') {
        const params = new URLSearchParams({ q: query });
        if (path && path !== '/') params.append('path', path);
        return request(`/api/search?${params}`);
    }

    /**
     * *CHANGE* Uploads files (or an entire folder) to a directory.
     * 
     * Previously this just appended files to FormData. Now it also sends
     * a parallel "relativePaths" array. For regular file uploads, each
     * entry is just the filename. For folder uploads, each entry is the 
     * file's path relative to the selected folder root (e.g., 
     * "subdir/deep/file.txt"), which tells the server to recreate that 
     * folder structure on disk.
     * 
     * @param {File[]} files - Array of File objects (not FileList, since
     *   folder drag-and-drop produces a plain array)
     * @param {string} path - Target directory on the server
     * @returns {Promise<{uploaded: string[]}>}
     */
    async function upload(files, path = '/') {
        const formData = new FormData();
        for (const file of files) {
            formData.append('files', file);
            // *CHANGE* Send the relative path alongside each file.
            // file._relativePath is set by our folder-reading logic in app.js.
            // For regular file picks it's undefined, so we fall back to the filename.
            formData.append('relativePaths', file._relativePath || file.name);
        }
        const params = new URLSearchParams({ path });
        return request(`/api/files/upload?${params}`, {
            method: 'POST',
            body: formData
        });
    }

    /**
     * *CHANGE* New API call: creates an empty folder.
     * POST /api/files/create-folder?path=/parent
     * Body: { folderName: "New Folder" }
     * 
     * @param {string} folderName - Name of the new folder
     * @param {string} path - Parent directory to create it in
     * @returns {Promise<{created: string}>}
     */
    async function createFolder(folderName, path = '/') {
        const params = new URLSearchParams({ path });
        return request(`/api/files/create-folder?${params}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderName })
        });
    }

    /**
     * Returns the download URL for a file (doesn't fetch it — 
     * the browser handles the download via an <a> tag or window.open).
     */
    function getDownloadUrl(path) {
        const cleanPath = path.replace(/^\//, '');
        return `/api/files/download/${cleanPath}`;
    }

    async function deleteEntry(path) {
        const cleanPath = path.replace(/^\//, '');
        return request(`/api/files/${cleanPath}`, { method: 'DELETE' });
    }

    async function moveEntry(sourcePath, destinationPath) {
        return request('/api/files/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourcePath, destinationPath })
        });
    }

    async function copyEntry(sourcePath, destinationPath) {
        return request('/api/files/copy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourcePath, destinationPath })
        });
    }

    // *CHANGE* Added createFolder to the public API
    return { browse, search, upload, getDownloadUrl, deleteEntry, moveEntry, copyEntry, createFolder };
})();
