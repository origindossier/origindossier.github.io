/* Included only in the public offline edition. Live application scripts stay unchanged. */
(function () {
    'use strict';
    const archive = window.ODArchive;
    if (!archive) throw new Error('Offline archive resources are missing.');
    const root = new URL('../', document.currentScript.src);
    const publicOrigin = 'https://origindossier.org';
    function publicPath(value) {
        if (!value || /^(#|mailto:|tel:|data:|javascript:)/i.test(value)) return null;
        if (value.startsWith(root.href)) return '/' + decodeURIComponent(value.slice(root.href.length).split(/[?#]/)[0]);
        if (root.protocol === 'file:' && value.startsWith(root.pathname)) return '/' + decodeURIComponent(value.slice(root.pathname.length).split(/[?#]/)[0]);
        if (/^\/(?!\/)/.test(value)) return decodeURIComponent(new URL(value, publicOrigin).pathname);
        try {
            const u = new URL(value, document.baseURI);
            if (u.href.startsWith(root.href)) return '/' + decodeURIComponent(u.href.slice(root.href.length).split(/[?#]/)[0]);
            return ['origindossier.org', 'www.origindossier.org', '127.0.0.1', 'localhost'].includes(u.hostname) ? decodeURIComponent(u.pathname) : null;
        } catch (_) { return null; }
    }
    function localUrl(value) {
        if (root.protocol === 'file:' && value.startsWith(root.pathname)) return new URL(value, root).href;
        let p = publicPath(value);
        if (!p || value.startsWith(root.href)) return value;
        const suffix = value.match(/[?#].*$/)?.[0] || '';
        if (p === '/') p = '/' + (document.documentElement.lang || 'en');
        return new URL((archive.routes[p.replace(/\/$/, '') || '/'] || p.replace(/^\//, '')) + suffix, root).href;
    }
    // file:// cannot fetch even neighboring JSON/MD in ordinary browser security mode.
    // Public API replies and legal texts are loaded synchronously from archive-resources.js.
    window.fetch = async function (input) {
        const value = typeof input === 'string' ? input : input.url;
        const key = publicPath(value);
        const resource = archive.resources[key];
        if (!resource) throw new Error('No archived response for ' + value);
        return new Response(resource.body, { status: resource.status, headers: { 'Content-Type': resource.type } });
    };
    function fixLinks(node) {
        if (!node || node.nodeType !== 1) return;
        if (typeof window.markdownit === 'function') {
            const quotes = node.matches('blockquote') ? [node] : [...node.querySelectorAll('.source-reason blockquote,.legal-source-quote blockquote,.od-tl-proof blockquote')];
            for (const quote of quotes) {
                if (!quote.children.length && !quote.dataset.archiveMarkdownRendered) {
                    quote.dataset.archiveMarkdownRendered = 'true';
                    quote.innerHTML = window.markdownit({html:false,linkify:false,breaks:true}).render(quote.textContent);
                }
            }
        }
        for (const el of [node, ...node.querySelectorAll('a[href],[data-law-article-href],[data-law-href],[data-fallback-url]')]) {
            for (const attr of ['href', 'data-law-article-href', 'data-law-href', 'data-fallback-url']) {
                const old = el.getAttribute(attr);
                if (!old || old.startsWith(root.href)) continue;
                const updated = localUrl(old);
                if (updated !== old) el.setAttribute(attr, updated);
            }
        }
    }
    document.addEventListener('click', function (event) {
        fixLinks(event.target.closest?.('a'));
    }, true);
    document.addEventListener('DOMContentLoaded', function () {
        fixLinks(document.body);
        new MutationObserver(mutations => {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes') fixLinks(mutation.target);
                else for (const node of mutation.addedNodes) fixLinks(node);
            }
        }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'data-law-article-href', 'data-law-href'] });
        const form = document.querySelector('[data-document-filters]');
        if (form) {
            const cards = [...document.querySelectorAll('[data-catalog-document]')];
            const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase(document.documentElement.lang);
            const entries = cards.map(card => ({ card, text: normalize(card.dataset.catalogSearch || card.textContent) }));
            const fields = ['q', 'category', 'year'];
            const query = new URLSearchParams(location.search);
            for (const field of fields) if (query.has(field)) form.elements.namedItem(field).value = query.get(field);
            function filter(update) {
                const q = form.elements.namedItem('q').value.trim().slice(0, 160);
                const terms = normalize(q).split(/\s+/).filter(Boolean);
                const category = form.elements.namedItem('category').value;
                const year = form.elements.namedItem('year').value;
                let count = 0;
                for (const { card, text } of entries) {
                    const show = (!category || category === card.dataset.catalogCategory) && (!year || year === card.dataset.catalogYear) && terms.every(term => text.includes(term));
                    card.hidden = !show;
                    card.style.display = show ? '' : 'none';
                    if (show) count++;
                }
                document.querySelector('[data-document-count]').textContent = count + ' / ' + cards.length;
                if (update) {
                    const url = new URL(location.href);
                    for (const field of fields) {
                        const value = form.elements.namedItem(field).value;
                        if (value) url.searchParams.set(field, value); else url.searchParams.delete(field);
                    }
                    try { history.replaceState(null, '', url.href); } catch (_) { /* file URL history differs by browser. */ }
                }
            }
            form.addEventListener('submit', event => { event.preventDefault(); filter(true); });
            filter(false);
        }
        const copy = document.getElementById('od-copy-transcript');
        copy?.addEventListener('click', async function () {
            const text = document.getElementById('od-captions-transcript').innerText;
            try { await navigator.clipboard.writeText(text); copy.textContent = copy.dataset.copied; }
            catch (_) {
                const selection = window.getSelection(), range = document.createRange();
                range.selectNodeContents(document.getElementById('od-captions-transcript'));
                selection.removeAllRanges(); selection.addRange(range);
            }
        });
    });
}());
