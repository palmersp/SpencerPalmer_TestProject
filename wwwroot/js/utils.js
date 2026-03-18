/**
 * utils.js — Pure utility functions with no DOM or state dependencies.
 */
const Utils = (() => {

    /**
     * Formats a byte count into a human-readable string.
     * Uses binary units (KiB, MiB, etc.) since we're dealing with file sizes.
     */
    function formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const k = 1024;
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        const value = bytes / Math.pow(k, i);
        return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
    }

    /**
     * Formats a UTC date string into a local readable format.
     */
    function formatDate(dateStr) {
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    /**
     * Returns an emoji/character icon based on file type.
     * Simple approach — a real app would use SVG icons.
     */
    function getIcon(entry) {
        if (entry.isDirectory) return '📁';

        const ext = (entry.extension || '').toLowerCase();
        const icons = {
            pdf: '📕', doc: '📄', docx: '📄', txt: '📝',
            xls: '📊', xlsx: '📊', csv: '📊',
            jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', svg: '🖼️',
            mp3: '🎵', wav: '🎵', mp4: '🎬', avi: '🎬',
            zip: '📦', rar: '📦', '7z': '📦',
            js: '⚙️', cs: '⚙️', py: '⚙️', html: '🌐', css: '🎨',
            exe: '⚡', dll: '🔧', json: '📋', xml: '📋'
        };
        return icons[ext] || '📄';
    }

    /**
     * Splits a path into breadcrumb segments.
     * "/" → [{ name: "Home", path: "/" }]
     * "/docs/reports" → [{ name: "Home", path: "/" }, { name: "docs", path: "/docs" }, ...]
     */
    function pathToBreadcrumbs(path) {
        const crumbs = [{ name: 'Home', path: '/' }];
        if (!path || path === '/') return crumbs;

        const parts = path.split('/').filter(Boolean);
        let accumulated = '';
        for (const part of parts) {
            accumulated += '/' + part;
            crumbs.push({ name: part, path: accumulated });
        }
        return crumbs;
    }

    /**
     * Creates a DOM element with optional attributes and children.
     * This is a lightweight JSX alternative — keeps the rendering code 
     * readable without pulling in a template library.
     * 
     * Usage: el('div', { className: 'foo' }, el('span', null, 'text'))
     */
    function el(tag, attrs, ...children) {
        const element = document.createElement(tag);

        if (attrs) {
            for (const [key, value] of Object.entries(attrs)) {
                if (key.startsWith('on') && typeof value === 'function') {
                    element.addEventListener(key.slice(2).toLowerCase(), value);
                } else if (key === 'className') {
                    element.className = value;
                } else if (key === 'htmlFor') {
                    element.htmlFor = value;
                } else {
                    element.setAttribute(key, value);
                }
            }
        }

        for (const child of children) {
            if (child == null) continue;
            if (typeof child === 'string' || typeof child === 'number') {
                element.appendChild(document.createTextNode(String(child)));
            } else if (child instanceof Node) {
                element.appendChild(child);
            } else if (Array.isArray(child)) {
                child.forEach(c => {
                    if (c instanceof Node) element.appendChild(c);
                });
            }
        }

        return element;
    }

    /**
     * Debounce utility — used for the search input so we don't 
     * fire an API call on every keystroke.
     */
    function debounce(fn, ms) {
        let timer;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), ms);
        };
    }

    return { formatSize, formatDate, getIcon, pathToBreadcrumbs, el, debounce };
})();
