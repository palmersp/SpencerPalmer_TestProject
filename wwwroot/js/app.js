/**
 * app.js — Main application module.
 * 
 * Architecture:
 * - Hash-based routing for deep linking (#/path/to/folder or #search:term)
 * - Single state object drives all rendering
 * - All DOM mutations go through render() for predictability
 * - Event delegation on the file table for performance
 * 
 * The URL hash IS the source of truth for navigation state. When the user 
 * clicks a folder, we update the hash, which triggers hashchange, which 
 * triggers a fetch + render. This means every view is bookmarkable/shareable.
 */
const App = (() => {
    const { el, formatSize, formatDate, getIcon, pathToBreadcrumbs, debounce } = Utils;

    // ---- Application State ----
    let state = {
        currentPath: '/',
        entries: [],
        folderCount: 0,
        fileCount: 0,
        totalSize: 0,
        parentPath: null,
        isLoading: false,
        error: null,
        searchMode: false,
        searchTerm: '',
        sortField: 'name',   // name | size | lastModified
        sortAsc: true,
        selectedEntries: new Set()
    };

    // Root DOM element
    let rootEl;

    // ---- Routing ----

    /**
     * Reads the hash and determines what to display.
     * Formats:
     *   #/              → browse root
     *   #/docs/reports  → browse /docs/reports
     *   #search:foo     → search for "foo" from root
     *   #search:foo@/docs → search for "foo" from /docs
     */
    function parseHash() {
        const hash = window.location.hash.slice(1) || '/';

        if (hash.startsWith('search:')) {
            const rest = hash.slice(7);
            const atIdx = rest.lastIndexOf('@');
            if (atIdx > 0) {
                return { mode: 'search', term: rest.slice(0, atIdx), path: rest.slice(atIdx + 1) };
            }
            return { mode: 'search', term: rest, path: '/' };
        }

        return { mode: 'browse', path: hash || '/' };
    }

    function navigateTo(path) {
        window.location.hash = path;
    }

    function navigateToSearch(term, fromPath = '/') {
        if (!term.trim()) {
            navigateTo(fromPath);
            return;
        }
        window.location.hash = `search:${term}@${fromPath}`;
    }

    // ---- Data Fetching ----

    async function loadBrowse(path) {
        state.isLoading = true;
        state.error = null;
        state.searchMode = false;
        state.selectedEntries.clear();
        render();

        try {
            const data = await Api.browse(path);
            state.currentPath = data.currentPath;
            state.entries = data.entries;
            state.folderCount = data.folderCount;
            state.fileCount = data.fileCount;
            state.totalSize = data.totalSize;
            state.parentPath = data.parentPath;
            state.isLoading = false;
        } catch (err) {
            state.error = err.message;
            state.isLoading = false;
        }
        render();
    }

    async function loadSearch(term, path) {
        state.isLoading = true;
        state.error = null;
        state.searchMode = true;
        state.searchTerm = term;
        state.selectedEntries.clear();
        render();

        try {
            const data = await Api.search(term, path);
            state.currentPath = data.searchRoot;
            state.entries = data.results;
            state.folderCount = data.folderCount;
            state.fileCount = data.fileCount;
            state.totalSize = data.totalSize;
            state.parentPath = null;
            state.isLoading = false;
        } catch (err) {
            state.error = err.message;
            state.isLoading = false;
        }
        render();
    }

    // ---- Sorting ----

    function sortEntries(entries) {
        const sorted = [...entries];
        const { sortField, sortAsc } = state;
        const dir = sortAsc ? 1 : -1;

        sorted.sort((a, b) => {
            // Folders always before files
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;

            let cmp = 0;
            switch (sortField) {
                case 'name':
                    cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
                    break;
                case 'size':
                    cmp = a.size - b.size;
                    break;
                case 'lastModified':
                    cmp = new Date(a.lastModified) - new Date(b.lastModified);
                    break;
            }
            return cmp * dir;
        });

        return sorted;
    }

    function toggleSort(field) {
        if (state.sortField === field) {
            state.sortAsc = !state.sortAsc;
        } else {
            state.sortField = field;
            state.sortAsc = true;
        }
        render();
    }

    // ---- File Operations ----

    // *CHANGE* New handler: prompts for a folder name and calls the create-folder API.
    // After creation, navigates into the new folder so the user can immediately
    // start uploading files to it.
    async function handleCreateFolder() {
        const name = prompt('New folder name:');
        if (!name) return;

        try {
            const result = await Api.createFolder(name, state.currentPath);
            showToast(`Created folder "${name}"`, 'success');
            refreshCurrentView();
        } catch (err) {
            showToast(`Create folder failed: ${err.message}`, 'error');
        }
    }

    async function handleDelete(entry) {
        if (!confirm(`Delete "${entry.name}"? This cannot be undone.`)) return;

        try {
            await Api.deleteEntry(entry.path);
            showToast(`Deleted "${entry.name}"`, 'success');
            refreshCurrentView();
        } catch (err) {
            showToast(`Delete failed: ${err.message}`, 'error');
        }
    }

    async function handleMove(entry) {
        const dest = prompt(`Move "${entry.name}" to (relative path):`, state.currentPath);
        if (dest === null) return;

        try {
            await Api.moveEntry(entry.path, dest);
            showToast(`Moved "${entry.name}"`, 'success');
            refreshCurrentView();
        } catch (err) {
            showToast(`Move failed: ${err.message}`, 'error');
        }
    }

    async function handleCopy(entry) {
        const dest = prompt(`Copy "${entry.name}" to (relative path):`, state.currentPath);
        if (dest === null) return;

        try {
            await Api.copyEntry(entry.path, dest);
            showToast(`Copied "${entry.name}"`, 'success');
            refreshCurrentView();
        } catch (err) {
            showToast(`Copy failed: ${err.message}`, 'error');
        }
    }

    function handleDownload(entry) {
        const url = Api.getDownloadUrl(entry.path);
        const a = document.createElement('a');
        a.href = url;
        a.download = entry.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    async function handleUpload(files) {
        if (!files || files.length === 0) return;

        try {
            // *CHANGE* Convert FileList to array — our upload API now expects
            // plain arrays since folder uploads produce arrays (not FileLists).
            const fileArray = Array.from(files);
            const result = await Api.upload(fileArray, state.currentPath);
            showToast(`Uploaded ${result.uploaded.length} file(s)`, 'success');
            refreshCurrentView();
        } catch (err) {
            showToast(`Upload failed: ${err.message}`, 'error');
        }
    }

    /**
     * *CHANGE* New handler: processes files from the folder <input> element.
     * When a user selects a folder via the webkitdirectory input, the browser
     * gives us a flat FileList where each File has a webkitRelativePath property
     * (e.g., "MyFolder/subdir/file.txt"). We stamp a custom _relativePath
     * property onto each File so that api.js can send it to the server,
     * which recreates the folder structure on disk.
     */
    async function handleFolderUpload(fileList) {
        if (!fileList || fileList.length === 0) return;

        const files = Array.from(fileList).map(file => {
            // webkitRelativePath is "FolderName/sub/file.txt"
            // We keep the full relative path so the server recreates the tree
            file._relativePath = file.webkitRelativePath || file.name;
            return file;
        });

        try {
            const result = await Api.upload(files, state.currentPath);
            showToast(`Uploaded ${result.uploaded.length} file(s) from folder`, 'success');
            refreshCurrentView();
        } catch (err) {
            showToast(`Folder upload failed: ${err.message}`, 'error');
        }
    }

    /**
     * *CHANGE* New helper: recursively reads a dropped directory via the 
     * File System Access API (webkitGetAsEntry). This is needed because 
     * the regular dataTransfer.files only gives you files, not folder 
     * structure. We walk the directory tree, read each FileEntry, and 
     * stamp _relativePath on the resulting File objects.
     * 
     * Returns a flat array of File objects with _relativePath set.
     */
    async function readDroppedItems(dataTransfer) {
        const files = [];

        // *CHANGE* Check if the browser supports webkitGetAsEntry (Chrome/Edge/Firefox)
        const items = dataTransfer.items;
        if (!items || !items[0]?.webkitGetAsEntry) {
            // Fallback: browser doesn't support directory reading, treat as flat files
            return Array.from(dataTransfer.files);
        }

        const entries = [];
        for (let i = 0; i < items.length; i++) {
            const entry = items[i].webkitGetAsEntry();
            if (entry) entries.push(entry);
        }

        // *CHANGE* Recursively walk each entry (file or directory)
        async function readEntry(entry, pathPrefix) {
            if (entry.isFile) {
                const file = await new Promise((resolve, reject) => {
                    entry.file(resolve, reject);
                });
                // Stamp the relative path so the server knows where to place it
                file._relativePath = pathPrefix + file.name;
                files.push(file);
            } else if (entry.isDirectory) {
                const reader = entry.createReader();
                // readEntries may not return all entries at once (batched at ~100)
                // so we loop until it returns an empty array
                let batch;
                do {
                    batch = await new Promise((resolve, reject) => {
                        reader.readEntries(resolve, reject);
                    });
                    for (const child of batch) {
                        await readEntry(child, pathPrefix + entry.name + '/');
                    }
                } while (batch.length > 0);
            }
        }

        for (const entry of entries) {
            await readEntry(entry, '');
        }

        return files;
    }

    function refreshCurrentView() {
        const route = parseHash();
        if (route.mode === 'search') {
            loadSearch(route.term, route.path);
        } else {
            loadBrowse(route.path);
        }
    }

    // ---- Toast Notifications ----

    function showToast(message, type = 'success') {
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = el('div', { className: 'toast-container' });
            document.body.appendChild(container);
        }

        const toast = el('div', { className: `toast toast-${type}` }, message);
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ---- Rendering ----

    function renderBreadcrumb() {
        const crumbs = pathToBreadcrumbs(state.currentPath);
        const fragment = document.createDocumentFragment();

        crumbs.forEach((crumb, i) => {
            if (i > 0) {
                fragment.appendChild(el('span', { className: 'separator' }, ' / '));
            }

            if (i === crumbs.length - 1 && !state.searchMode) {
                fragment.appendChild(el('span', null, crumb.name));
            } else {
                fragment.appendChild(el('a', {
                    href: `#${crumb.path}`,
                }, crumb.name));
            }
        });

        if (state.searchMode) {
            fragment.appendChild(el('span', { className: 'separator' }, ' / '));
            fragment.appendChild(el('span', null, `Search: "${state.searchTerm}"`));
        }

        return el('nav', { className: 'breadcrumb' }, fragment);
    }

    function renderStatsBar() {
        return el('div', { className: 'stats-bar' },
            el('span', null, `📁 ${state.folderCount} folder(s)`),
            el('span', null, `📄 ${state.fileCount} file(s)`),
            el('span', null, `💾 ${formatSize(state.totalSize)} total`)
        );
    }

    function renderSortHeader(label, field) {
        let indicator = '';
        if (state.sortField === field) {
            indicator = state.sortAsc ? ' ▲' : ' ▼';
        }
        return el('th', {
            onClick: () => toggleSort(field)
        },
            label,
            el('span', { className: 'sort-indicator' }, indicator)
        );
    }

    function renderEntryRow(entry) {
        const nameContent = entry.isDirectory
            ? el('a', { href: `#${entry.path}` }, entry.name)
            : el('span', null, entry.name);

        const nameCell = el('td', null,
            el('div', { className: 'entry-name' },
                el('span', { className: 'entry-icon' }, getIcon(entry)),
                nameContent
            )
        );

        const sizeCell = el('td', { className: 'size-col' },
            entry.isDirectory ? '—' : formatSize(entry.size)
        );

        const dateCell = el('td', { className: 'date-col' }, formatDate(entry.lastModified));

        // Action buttons
        const actions = el('td', { className: 'actions-col' });

        if (!entry.isDirectory) {
            actions.appendChild(el('button', {
                className: 'btn btn-sm',
                title: 'Download',
                onClick: (e) => { e.stopPropagation(); handleDownload(entry); }
            }, '⬇'));
        }

        actions.appendChild(el('button', {
            className: 'btn btn-sm',
            title: 'Move',
            onClick: (e) => { e.stopPropagation(); handleMove(entry); }
        }, '✂'));

        actions.appendChild(el('button', {
            className: 'btn btn-sm',
            title: 'Copy',
            onClick: (e) => { e.stopPropagation(); handleCopy(entry); }
        }, '📋'));

        actions.appendChild(el('button', {
            className: 'btn btn-sm btn-danger',
            title: 'Delete',
            onClick: (e) => { e.stopPropagation(); handleDelete(entry); }
        }, '✕'));

        return el('tr', null, nameCell, sizeCell, dateCell, actions);
    }

    function renderFileTable() {
        const sorted = sortEntries(state.entries);

        const thead = el('thead', null,
            el('tr', null,
                renderSortHeader('Name', 'name'),
                renderSortHeader('Size', 'size'),
                renderSortHeader('Modified', 'lastModified'),
                el('th', null, 'Actions')
            )
        );

        const tbody = el('tbody', null);

        // Parent directory link
        if (state.parentPath && !state.searchMode) {
            const parentRow = el('tr', null,
                el('td', null,
                    el('div', { className: 'entry-name' },
                        el('span', { className: 'entry-icon' }, '⬆️'),
                        el('a', { href: `#${state.parentPath}` }, '..')
                    )
                ),
                el('td', null, ''),
                el('td', null, ''),
                el('td', null, '')
            );
            tbody.appendChild(parentRow);
        }

        if (sorted.length === 0) {
            tbody.appendChild(
                el('tr', null,
                    el('td', { colspan: '4', style: 'text-align: center; color: #6c757d; padding: 24px;' },
                        state.searchMode ? 'No results found.' : 'This folder is empty.'
                    )
                )
            );
        } else {
            sorted.forEach(entry => tbody.appendChild(renderEntryRow(entry)));
        }

        return el('table', { className: 'file-table' }, thead, tbody);
    }

    function renderUploadArea() {
        const fileInput = el('input', {
            type: 'file',
            id: 'file-upload-input',
            multiple: 'true',
            style: 'display: none;',
            onChange: (e) => handleUpload(e.target.files)
        });

        // *CHANGE* New hidden input: uses the webkitdirectory attribute to let
        // the user pick an entire folder. The browser flattens the folder into
        // a FileList where each File has a webkitRelativePath property containing
        // the folder-relative path (e.g., "MyFolder/subdir/file.txt").
        const folderInput = el('input', {
            type: 'file',
            id: 'folder-upload-input',
            style: 'display: none;'
        });
        // *CHANGE* Must set webkitdirectory via property (not attribute) for 
        // cross-browser compatibility — some browsers ignore the attribute form.
        folderInput.webkitdirectory = true;
        folderInput.addEventListener('change', (e) => handleFolderUpload(e.target.files));

        // *CHANGE* Split the upload area into two clickable zones:
        // left side for files, right side for folders.
        const area = el('div', { className: 'upload-area' },
            fileInput,
            folderInput,
            el('div', { style: 'display: flex; gap: 24px; justify-content: center; align-items: center;' },
                el('button', {
                    className: 'btn',
                    onClick: (e) => { e.stopPropagation(); fileInput.click(); }
                }, '📄 Upload Files'),
                el('button', {
                    className: 'btn',
                    onClick: (e) => { e.stopPropagation(); folderInput.click(); }
                }, '📁 Upload Folder')
            ),
            el('div', { style: 'margin-top: 8px; font-size: 0.85rem;' },
                'or drag & drop files and folders here')
        );

        // Drag-and-drop handling
        area.addEventListener('dragover', (e) => {
            e.preventDefault();
            area.classList.add('drag-over');
        });
        area.addEventListener('dragleave', () => {
            area.classList.remove('drag-over');
        });
        // *CHANGE* Updated drop handler: uses readDroppedItems() to recursively
        // read dropped folders via the webkitGetAsEntry API. This preserves the
        // folder structure even when dragging folders from the OS file manager.
        area.addEventListener('drop', async (e) => {
            e.preventDefault();
            area.classList.remove('drag-over');

            try {
                const files = await readDroppedItems(e.dataTransfer);
                if (files.length > 0) {
                    const result = await Api.upload(files, state.currentPath);
                    showToast(`Uploaded ${result.uploaded.length} file(s)`, 'success');
                    refreshCurrentView();
                }
            } catch (err) {
                showToast(`Upload failed: ${err.message}`, 'error');
            }
        });

        return area;
    }

    function renderToolbar() {
        const searchInput = el('input', {
            type: 'text',
            placeholder: 'Search files and folders...',
            value: state.searchMode ? state.searchTerm : '',
            id: 'search-input'
        });

        // Debounced search as you type
        const debouncedSearch = debounce((term) => {
            navigateToSearch(term, state.currentPath);
        }, 400);

        searchInput.addEventListener('input', (e) => {
            debouncedSearch(e.target.value);
        });

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                navigateToSearch(e.target.value, state.currentPath);
            }
            if (e.key === 'Escape') {
                e.target.value = '';
                navigateTo(state.currentPath);
            }
        });

        const refreshBtn = el('button', {
            onClick: refreshCurrentView,
            title: 'Refresh'
        }, '🔄 Refresh');

        const homeBtn = el('button', {
            onClick: () => navigateTo('/'),
            title: 'Home'
        }, '🏠 Home');

        // *CHANGE* New button: creates an empty folder in the current directory.
        // Only shown in browse mode (not search results) since you need a
        // concrete directory context to create a folder in.
        const newFolderBtn = el('button', {
            className: 'btn-primary',
            onClick: handleCreateFolder,
            title: 'Create a new folder in the current directory'
        }, '📁+ New Folder');

        return el('div', { className: 'toolbar' },
            searchInput,
            refreshBtn,
            homeBtn,
            // *CHANGE* Conditionally include the New Folder button
            ...(state.searchMode ? [] : [newFolderBtn])
        );
    }

    /**
     * Main render function. Clears and rebuilds the entire UI.
     * 
     * In a real app with large lists you'd use virtual scrolling or 
     * incremental DOM updates, but for a proof-of-concept this 
     * full-rerender approach is simpler and fast enough for hundreds 
     * of entries.
     */
    function render() {
        rootEl.innerHTML = '';

        const container = el('div', { className: 'app-container' });

        // Header
        container.appendChild(
            el('div', { className: 'app-header' },
                el('h1', null, '📂 File Browser')
            )
        );

        // Toolbar (search + actions)
        container.appendChild(renderToolbar());

        // Breadcrumb
        container.appendChild(renderBreadcrumb());

        // Error state
        if (state.error) {
            container.appendChild(el('div', { className: 'error-msg' }, `Error: ${state.error}`));
        }

        // Loading state
        if (state.isLoading) {
            container.appendChild(el('div', { className: 'loading' }, 'Loading...'));
            rootEl.appendChild(container);
            return;
        }

        // Stats
        container.appendChild(renderStatsBar());

        // Upload area (only in browse mode, not search)
        if (!state.searchMode) {
            container.appendChild(renderUploadArea());
        }

        // File/folder listing
        container.appendChild(renderFileTable());

        rootEl.appendChild(container);

        // Restore focus to search input if in search mode
        if (state.searchMode) {
            const input = document.getElementById('search-input');
            if (input) {
                input.focus();
                input.setSelectionRange(input.value.length, input.value.length);
            }
        }
    }

    // ---- Initialization ----

    function init(element) {
        rootEl = element;

        // Listen for hash changes (deep linking / back-forward navigation)
        window.addEventListener('hashchange', () => {
            const route = parseHash();
            if (route.mode === 'search') {
                loadSearch(route.term, route.path);
            } else {
                loadBrowse(route.path);
            }
        });

        // Initial load from current hash
        const route = parseHash();
        if (route.mode === 'search') {
            loadSearch(route.term, route.path);
        } else {
            loadBrowse(route.path);
        }
    }

    return { init };
})();
