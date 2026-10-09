(function (window, document) {
    'use strict';

    var OD = window.OriginDossier = window.OriginDossier || {};

    var cache = Object.create(null);
    var openRequest = 0;
    var lastTrigger = null;

    var labels = {
        en: {
            unavailable: 'The legal text is not available for this reference.',
            source: 'Open source',
            close: 'Close',
            loading: 'Loading article...',
            missing: 'Article not found.'
        },
        hr: {
            unavailable: 'Pravni tekst nije dostupan za ovu referencu.',
            source: 'Otvori izvor',
            close: 'Zatvori',
            loading: 'Učitavanje članka...',
            missing: 'Članak nije pronađen.'
        },
        hu: {
            unavailable: 'Ehhez a hivatkozáshoz nem érhető el a jogszabály szövege.',
            source: 'Forrás megnyitása',
            close: 'Bezárás',
            loading: 'A cikk betöltése...',
            missing: 'A cikk nem található.'
        }
    };

    function normalizeLang(value) {
        value = (value || '').toLowerCase();
        if (value === 'hr' || value === 'hu' || value === 'en') {
            return value;
        }
        return 'en';
    }

    function normalizeHeadingLine(value) {
        return String(value || '')
            .trim()
            .replace(/^#{1,6}\s*/, '')
            .replace(/^[-–—•]\s*/, '')
            .replace(/\*\*/g, '')
            .replace(/__+/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function articleNumberFromHeading(line, lang) {
        var text = normalizeHeadingLine(line);
        var match;

        if (lang === 'hr') {
            // Accept both the correct cleaned heading "Članak 35." and the previously corrupted "Člankak 35.".
            match = text.match(/^Član(?:ak|kak)\s+(\d+|[IVXLCDM]+)\.?$/i);
            return match ? match[1].toUpperCase() : '';
        }

        if (lang === 'hu') {
            match = text.match(/^(\d+|[IVXLCDM]+)\.\s*cikk\.?$/i);
            return match ? match[1].toUpperCase() : '';
        }

        match = text.match(/^Article\s+(\d+|[IVXLCDM]+)\.?$/i);
        return match ? match[1].toUpperCase() : '';
    }

    async function loadMarkdown(lawKey, lang) {
        var key = lawKey + ':' + lang;
        if (cache[key]) { return cache[key]; }
        var pending = (async function () {
            var response = await fetch('/' + lang + '/legal-sources/' + encodeURIComponent(lawKey), { headers: { Accept: 'application/json' } });
            if (!response.ok) { throw new Error('Legal source request failed: ' + response.status); }
            var source = await response.json();
            var returnedKey = source.lawKey !== undefined ? source.lawKey : source.LawKey;
            if (returnedKey !== lawKey) { throw new Error('The legal source does not match the requested law.'); }
            var markdownUrl = source.markdownUrl !== undefined ? source.markdownUrl : source.MarkdownUrl;
            if (!markdownUrl) { return { source: source, markdown: null }; }
            var markdownResponse = await fetch(markdownUrl, { cache: 'no-cache' });
            if (!markdownResponse.ok) { throw new Error('Legal text request failed: ' + markdownResponse.status); }
            return { source: source, markdown: await markdownResponse.text() };
        })();
        cache[key] = pending;
        try { return await pending; }
        catch (error) { if (cache[key] === pending) { delete cache[key]; } throw error; }
    }
    function extractArticle(markdown, lang, articleNumber) {
        lang = normalizeLang(lang);
        var value = String(articleNumber || '').trim();
        var requested = value.length <= 32 ? value.match(/^([1-9][0-9]{0,3}|[IVXLCDM]{1,12})(?:\([a-z0-9]{1,4}\)){0,3}$/i) : null;
        articleNumber = requested ? requested[1].toUpperCase() : '';

        if (!articleNumber) {
            return '';
        }

        var lines = String(markdown || '').replace(/\r/g, '').split('\n');
        var startIndex = -1;

        for (var i = 0; i < lines.length; i += 1) {
            if (articleNumberFromHeading(lines[i], lang) === articleNumber) {
                startIndex = i;
                break;
            }
        }

        if (startIndex < 0) {
            return '';
        }

        var endIndex = lines.length;

        for (var j = startIndex + 1; j < lines.length; j += 1) {
            var nextNumber = articleNumberFromHeading(lines[j], lang);
            if (nextNumber && nextNumber !== articleNumber) {
                endIndex = j;
                break;
            }
        }

        return lines.slice(startIndex, endIndex).join('\n').trim();
    }

    function ensurePopup() {
        var existing = document.getElementById('law-article-popup');
        if (existing) {
            return existing;
        }

        var shell = document.createElement('div');
        shell.id = 'law-article-popup';
        shell.className = 'law-popup is-hidden';
        shell.innerHTML =
            '<div class="law-popup-backdrop" data-law-popup-close></div>' +
            '<section class="law-popup-panel" role="dialog" aria-modal="true" aria-labelledby="law-popup-title">' +
                '<div class="law-popup-head">' +
                    '<div>' +
                        '<div class="law-popup-kicker" data-law-popup-kicker></div>' +
                        '<h2 id="law-popup-title" data-law-popup-title></h2>' +
                    '</div>' +
                    '<button type="button" class="law-popup-close" data-law-popup-close aria-label="Close">×</button>' +
                '</div>' +
                '<div class="law-popup-body" data-law-popup-body></div>' +
            '</section>';

        document.body.appendChild(shell);

        shell.addEventListener('click', function (event) {
            if (event.target.closest('[data-law-popup-close]')) {
                closePopup();
            }
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                closePopup();
            }
        });

        return shell;
    }

    function closePopup() {
        var popup = document.getElementById('law-article-popup');
        if (!popup) {
            return;
        }

        openRequest += 1;
        popup.classList.add('is-hidden');
        document.body.classList.remove('law-popup-open');
        if (lastTrigger && lastTrigger.isConnected) { lastTrigger.focus({ preventScroll: true }); }
    }

    function escapeHtml(value) {
        return String(value || '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    function renderMarkdown(markdown) {
        if (typeof window.markdownit === 'function') {
            return window.markdownit({
                html: true,
                linkify: true,
                typographer: false,
                breaks: true
            }).render(markdown || '');
        }

        return '<pre>' + escapeHtml(markdown || '') + '</pre>';
    }

    function getArticleLabel(lang, articleNumber) {
        if (lang === 'hr') {
            return 'Članak ' + articleNumber + '.';
        }

        if (lang === 'hu') {
            var bracket = String(articleNumber).indexOf('(');
            return bracket > 0 ? articleNumber.slice(0, bracket) + '. cikk ' + articleNumber.slice(bracket) : articleNumber + '. cikk';
        }

        return 'Article ' + articleNumber;
    }

    async function openArticle(articleNumber, lang, lawKey, articleHref, trigger) {
        lang = normalizeLang(lang);
        var text = labels[lang] || labels.en, popup = ensurePopup(), request = ++openRequest;
        lastTrigger = trigger || null;
        popup.setAttribute('data-law-source', trigger && trigger.getAttribute('data-law-source') || 'historical');
        popup.setAttribute('data-law-key', lawKey || '');
        popup.querySelector('[data-law-popup-kicker]').textContent = '';
        popup.querySelector('[data-law-popup-title]').textContent = getArticleLabel(lang, articleNumber);
        popup.querySelector('[data-law-popup-body]').textContent = lawKey ? text.loading : text.unavailable;
        var close = popup.querySelector('.law-popup-close'); close.setAttribute('aria-label', text.close);
        var sourceLink = popup.querySelector('[data-law-popup-source]');
        if (!sourceLink) { sourceLink = document.createElement('a'); sourceLink.className = 'law-popup-source'; sourceLink.setAttribute('data-law-popup-source', ''); popup.querySelector('.law-popup-panel').appendChild(sourceLink); }
        sourceLink.hidden = true; sourceLink.removeAttribute('href'); sourceLink.textContent = text.source;
        popup.classList.remove('is-hidden'); document.body.classList.add('law-popup-open'); close.focus({ preventScroll: true });
        if (!lawKey) { return; }
        try {
            var loaded = await loadMarkdown(lawKey, lang);
            if (request !== openRequest) { return; }
            var source = loaded.source;
            popup.querySelector('[data-law-popup-kicker]').textContent = source.title || source.Title || lawKey;
            var href = articleHref || source.documentUrl || source.DocumentUrl;
            if (href) { sourceLink.href = href; sourceLink.hidden = false; }
            if (loaded.markdown == null) { popup.querySelector('[data-law-popup-body]').textContent = text.unavailable; return; }
            var article = extractArticle(loaded.markdown, lang, articleNumber);
            popup.querySelector('[data-law-popup-body]').innerHTML = article ? renderMarkdown(article) : '';
            if (!article) { popup.querySelector('[data-law-popup-body]').textContent = text.missing; }
        } catch (error) {
            if (request !== openRequest) { return; }
            console.warn('[OriginDossier] Legal source unavailable', error);
            popup.querySelector('[data-law-popup-body]').textContent = text.unavailable;
        }
    }
    function initLawArticlePopup() {
        document.addEventListener('click', function (event) {
            var link = event.target.closest('[data-law-article]');
            if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                return;
            }

            var articleNumber = link.getAttribute('data-law-article');
            var lang =
                link.getAttribute('data-law-lang') ||
                document.documentElement.getAttribute('lang') ||
                'en';

            if (!articleNumber) {
                return;
            }

            event.preventDefault();
            var lawKey = link.getAttribute('data-law-key');
            var articleHref = link.getAttribute('data-law-article-href') || link.getAttribute('data-law-href');
            openArticle(articleNumber, lang, lawKey, articleHref, link);
        });
    }

    OD.initLawArticlePopup = initLawArticlePopup;
})(window, document);

