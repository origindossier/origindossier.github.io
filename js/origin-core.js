(function (window, document) {
    'use strict';

    var OD = window.OriginDossier = window.OriginDossier || {};

    function safeParse(json) {
        try {
            return JSON.parse(json || '{}');
        } catch (error) {
            return {};
        }
    }

    function escapeRegExp(value) {
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function makeAnnotationRegex(annotation) {
        var matchText = annotation.matchText || annotation.MatchText || '';
        if (!matchText) {
            return null;
        }

        matchText = normalizedText(matchText);
        if (!matchText) { return null; }
        var pattern = escapeRegExp(matchText);
        if (/^\p{N}/u.test(matchText)) { pattern = '(?<!\\p{N})' + pattern; }
        if (/\p{N}$/u.test(matchText)) { pattern += '(?!\\p{N})'; }
        var wholeWord = annotation.wholeWord !== undefined ? annotation.wholeWord : annotation.WholeWord;
        var caseSensitive = annotation.caseSensitive !== undefined ? annotation.caseSensitive : annotation.CaseSensitive;

        if (wholeWord) {
            pattern = '(^|[^\\p{L}\\p{N}_])(' + pattern + ')(?=$|[^\\p{L}\\p{N}_])';
        } else {
            pattern = '(' + pattern + ')';
        }

        try {
            return new RegExp(pattern, caseSensitive ? 'gu' : 'giu');
        } catch (error) {
            return null;
        }
    }

    function normalizedText(text) {
        return String(text || '').replace(/\s+/gu, ' ').trim();
    }

    function annotationValue(annotation, camelName, pascalName) {
        return annotation[camelName] !== undefined ? annotation[camelName] : annotation[pascalName];
    }

    function normalizeAnnotation(annotation) {
        return {
            annotationId: annotationValue(annotation, 'annotationId', 'AnnotationId'),
            documentKey: annotationValue(annotation, 'documentKey', 'DocumentKey'),
            assetId: annotationValue(annotation, 'assetId', 'AssetId'),
            language: annotationValue(annotation, 'language', 'Language'),
            matchText: annotationValue(annotation, 'matchText', 'MatchText'),
            normalizedText: annotationValue(annotation, 'normalizedText', 'NormalizedText'),
            annotationType: annotationValue(annotation, 'annotationType', 'AnnotationType') || 'identity-person',
            displayLabel: annotationValue(annotation, 'displayLabel', 'DisplayLabel'),
            note: annotationValue(annotation, 'note', 'Note'),
            targetDocumentKey: annotationValue(annotation, 'targetDocumentKey', 'TargetDocumentKey'),
            targetTimelineKey: annotationValue(annotation, 'targetTimelineKey', 'TargetTimelineKey'),
            lawArticleNumber: annotationValue(annotation, 'lawArticleNumber', 'LawArticleNumber'),
            personKey: annotationValue(annotation, 'personKey', 'PersonKey'),
            placeKey: annotationValue(annotation, 'placeKey', 'PlaceKey'),
            priority: annotationValue(annotation, 'priority', 'Priority') || 0,
            caseSensitive: !!annotationValue(annotation, 'caseSensitive', 'CaseSensitive'),
            wholeWord: annotationValue(annotation, 'wholeWord', 'WholeWord') !== false,
            enabled: annotationValue(annotation, 'enabled', 'Enabled') !== false
        };
    }

    var annotationBlocks = 'p,li,h1,h2,h3,h4,h5,h6,td,th,blockquote';
    function extendedAnnotation(item) {
        var annotation = normalizeAnnotation(item);
        ['lawKey','lawTitle','lawMarkdownUrl','lawArticleHref','lawSource','lawLinkLabel','canOpenLawArticle','contextNote','fallbackContextNote','originalNote','targetDocumentUrl','targetTimelineUrl','pageHint','claimKey','sourceRole','matchScope','contextStatus','personName'].forEach(function (name) {
            annotation[name] = annotationValue(item, name, name.charAt(0).toUpperCase() + name.slice(1));
        });
        var contexts = annotationValue(item, 'contexts', 'Contexts');
        annotation.contexts = (Array.isArray(contexts) ? contexts : []).map(function (context) {
            function field(name) { return annotationValue(context, name, name.charAt(0).toUpperCase() + name.slice(1)); }
            return { annotationId: field('annotationId'), sourceAssetId: field('sourceAssetId'), startLine: Number(field('startLine')), endLine: Number(field('endLine') || field('startLine')), sourceQuote: field('sourceQuote'), contextPersonName: field('contextPersonName'), contextNote: field('contextNote'), contextLabel: field('contextLabel'), contextPersonKey: field('contextPersonKey'), showOriginalNote: Number(field('showOriginalNote')) === 1, sourceHref: field('sourceHref') };
        });
        annotation._regex = makeAnnotationRegex(annotation);
        return annotation;
    }
    function blockSourceLines(block) {
        var source = block && block.closest('[data-source-line]');
        return { start: source ? Number(source.getAttribute('data-source-line')) : 0, end: source ? Number(source.getAttribute('data-source-end-line') || source.getAttribute('data-source-line')) : 0 };
    }
    var quoteMarkdown = null;
    function normalizedMarkdownQuote(quote) {
        if (!quote || typeof window.markdownit !== 'function') { return normalizedText(quote); }
        if (!quoteMarkdown) { quoteMarkdown = window.markdownit({ html: true, linkify: false, breaks: true, typographer: false }); }
        // A bare Hungarian legal heading is a citation, not an ordered-list marker.
        var sourceQuote = String(quote).replace(/^([ \t]*)(\d+)\.([ \t]+(?=[^\r\n]*cikk))/gimu, '$1$2\\.$3');
        var container = document.createElement('div'); container.innerHTML = quoteMarkdown.render(sourceQuote);
        var parts = [], walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
            acceptNode: function (node) { return node.nodeType === 3 || node.tagName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP; }
        });
        var node;
        while ((node = walker.nextNode())) { parts.push(node.nodeType === 3 ? node.nodeValue : ' '); }
        return normalizedText(parts.join(''));
    }
    function annotationContexts(annotation, assetId, block, group) {
        if (annotation.contextStatus === 'source-changed') { return []; }
        var lines = blockSourceLines(block);
        var candidates = annotation.contexts.filter(function (context) {
            return String(context.sourceAssetId) === String(assetId)
                && (context.annotationId == null || String(context.annotationId) === String(annotation.annotationId))
                && context.startLine <= lines.end && context.endLine >= lines.start;
        });
        if (!group) { return candidates; }
        var hits = group.hits.filter(function (hit) { return String(hit.annotation.annotationId) === String(annotation.annotationId); });
        return candidates.filter(function (context) {
            var positionedHits = hits.filter(function (hit) {
                var first = group.positions[hit.start], last = group.positions[hit.end - 1];
                return !first || !last || !first.sourceLine || !last.sourceLine || (first.sourceLine <= context.endLine && last.sourceLine >= context.startLine);
            });
            if (!positionedHits.length) { return false; }
            if (!context.sourceQuote) { return true; }
            if (context._quoteText === undefined) { context._quoteText = normalizedMarkdownQuote(context.sourceQuote); }
            var quote = context._quoteText, text = group.sourceText;
            if (!annotation.caseSensitive) { quote = quote.toLocaleLowerCase(); text = text.toLocaleLowerCase(); }
            if (!quote || !text) { return false; }
            if (quote.indexOf(text) !== -1) { return true; }
            var index = text.indexOf(quote);
            while (index !== -1) {
                if (positionedHits.some(function (hit) { return hit.start >= index && hit.end <= index + quote.length; })) { return true; }
                index = text.indexOf(quote, index + 1);
            }
            return false;
        });
    }
    function mapBlockText(block) {
        var text = '', positions = [], pending = null, sourceLine = blockSourceLines(block).start;
        function append(char, position) {
            if (/\s/u.test(char)) { if (text && !pending) { pending = position || {}; } return; }
            if (pending) { text += ' '; positions.push(pending); pending = null; }
            text += char; positions.push(position);
        }
        var walker = document.createTreeWalker(block, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
            acceptNode: function (node) {
                if (node.nodeType === 1) {
                    if (node.matches('script,style,textarea,button,.annotation-hit') || node.matches(annotationBlocks)) { return NodeFilter.FILTER_REJECT; }
                    return node.tagName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        var node;
        while ((node = walker.nextNode())) {
            if (node.nodeType === 1) { append(' ', null); sourceLine += 1; continue; }
            var wrap = !node.parentElement.closest('a,code,pre');
            for (var index = 0; index < node.nodeValue.length; index += 1) { append(node.nodeValue[index], { node: node, offset: index, wrap: wrap, sourceLine: sourceLine }); }
        }
        return { text: text, positions: positions };
    }
    function blockAnnotationGroups(text, annotations, block, assetId, positions, coverage) {
        var hits = [];
        annotations.forEach(function (annotation) {
            if (!annotation.enabled || !annotation._regex) { return; }
            var scope = String(annotation.matchScope || '').toLowerCase();
            if (scope === 'heading' || scope === 'title' || scope === 'title/heading') {
                var heading = /^H[1-6]$/.test(block.tagName) || block.getAttribute('role') === 'heading';
                var standalone = block.tagName === 'P' && !!block.querySelector('strong') && normalizedText(annotation.matchText).toLocaleLowerCase() === text.toLocaleLowerCase();
                if (!heading && !standalone) { return; }
            }
            annotation._regex.lastIndex = 0;
            var match;
            while ((match = annotation._regex.exec(text))) {
                var phrase = match[2] !== undefined ? match[2] : match[1];
                var start = match.index + (match[2] !== undefined ? match[1].length : 0);
                if (!phrase) { annotation._regex.lastIndex += 1; continue; }
                var hit = { start: start, end: start + phrase.length, annotation: annotation };
                var scoped = annotation.contextStatus !== 'source-changed' && annotation.contexts.some(function (context) { return String(context.sourceAssetId) === String(assetId); });
                if (scoped && !annotationContexts(annotation, assetId, block, { hits: [hit], sourceText: text, positions: positions }).length) {
                    coverage.suppressed.push({ annotationId: annotation.annotationId, assetId: assetId, sourceLine: positions[start] && positions[start].sourceLine || blockSourceLines(block).start, matchText: phrase, start: start, end: hit.end });
                    continue;
                }
                if (scoped) { coverage.contextualHits += 1; }
                hits.push(hit);
            }
        });
        hits.sort(function (a, b) { return a.start - b.start || b.end - a.end || b.annotation.priority - a.annotation.priority; });
        var groups = [];
        hits.forEach(function (hit) {
            var group = groups[groups.length - 1];
            if (!group || hit.start >= group.end) { group = { start: hit.start, end: hit.end, annotations: [], hits: [] }; groups.push(group); }
            group.end = Math.max(group.end, hit.end); group.hits.push(hit);
            if (!group.annotations.some(function (annotation) { return annotation.annotationId === hit.annotation.annotationId; })) { group.annotations.push(hit.annotation); }
        });
        return groups;
    }
    function applyBlockAnnotations(root, annotations, assetId) {
        var viewer = root.closest('[data-markdown-viewer]');
        var culture = viewer ? annotationCulture(viewer) : 'en';
        var coverage = { suppressed: [], contextualHits: 0 }; root.__originAnnotationCoverage = coverage;
        var prepared = annotations.map(extendedAnnotation).filter(function (annotation) { return annotation.enabled && annotation._regex; });
        root.querySelectorAll(annotationBlocks).forEach(function (block) {
            var mapped = mapBlockText(block);
            var groups = blockAnnotationGroups(mapped.text, prepared, block, assetId, mapped.positions, coverage);
            var nodeSegments = new Map();
            groups.forEach(function (group) {
                group.text = mapped.text.slice(group.start, group.end); group.block = block; group.assetId = assetId; group.sourceText = mapped.text; group.positions = mapped.positions;
                var segments = [];
                for (var index = group.start; index < group.end; index += 1) {
                    var position = mapped.positions[index];
                    if (!position || !position.node || !position.wrap) { continue; }
                    var last = segments[segments.length - 1];
                    if (last && last.node === position.node && last.end === position.offset) { last.end += 1; }
                    else { segments.push({ node: position.node, start: position.offset, end: position.offset + 1, group: group }); }
                }
                segments.forEach(function (segment, index) {
                    segment.first = index === 0;
                    if (!nodeSegments.has(segment.node)) { nodeSegments.set(segment.node, []); }
                    nodeSegments.get(segment.node).push(segment);
                });
            });
            nodeSegments.forEach(function (segments, node) {
                segments.sort(function (a, b) { return b.start - a.start; }).forEach(function (segment) {
                    var selected = node.splitText(segment.start); selected.splitText(segment.end - segment.start);
                    var primary = segment.group.annotations.slice().sort(function (a, b) { return b.priority - a.priority; })[0];
                    var span = document.createElement('span');
                    span.className = 'annotation-hit annotation-' + String(primary.annotationType).replace(/[^a-z0-9_-]/gi, '-');
                    span.tabIndex = segment.first ? 0 : -1; span.setAttribute('role', 'button');
                    span.setAttribute('data-annotation-id', String(primary.annotationId));
                    span.setAttribute('data-annotation-ids', segment.group.annotations.map(function (annotation) { return annotation.annotationId; }).join(','));
                    var localLabels = annotationContexts(primary, assetId, block, segment.group).map(function (context) { return context.contextLabel; }).filter(Boolean);
                    span.setAttribute('aria-label', primary.contextStatus === 'source-changed' ? annotationWords[culture].changedLabel : (Array.from(new Set(localLabels)).join(' · ') || primary.displayLabel || primary.matchText));
                    span.__originAnnotationGroup = segment.group;
                    selected.parentNode.replaceChild(span, selected); span.appendChild(selected);
                });
            });
        });
        root.setAttribute('data-annotation-uncovered-count', String(coverage.suppressed.length));
    }
    function applyAnnotations(root, annotations) {
        var viewer = root.closest('[data-markdown-viewer]');
        applyBlockAnnotations(root, annotations || [], viewer ? viewer.getAttribute('data-asset-id') : null);
    }
    var annotationWords = {
        en: { close: 'Close', notes: 'Comments on this passage', broader: 'Broader comment', shared: 'Shared comment', person: 'Person', article: 'Article', legalSource: 'Legal source', target: 'Related material', document: 'Open document', timeline: 'Open timeline event', source: 'Source passage', page: 'Page / passage', pdfPage: 'PDF page', transcript: 'Transcript pagination', claim: 'Claim', role: 'Source role', unavailable: 'The legal text is not available for this reference.', error: 'Annotations could not be loaded.', changed: 'The linked source passage has changed. The earlier comment has not been verified against this version.', changedLabel: 'Source passage changed', previous: 'Earlier comment — source changed' },
        hr: { close: 'Zatvori', notes: 'Komentari uz ovaj odlomak', broader: 'Širi komentar', shared: 'Isti komentar', person: 'Osoba', article: 'Članak', legalSource: 'Pravni izvor', target: 'Povezani materijal', document: 'Otvori dokument', timeline: 'Otvori događaj', source: 'Odlomak izvora', page: 'Stranica / odlomak', pdfPage: 'Stranica PDF-a', transcript: 'Numeracija prijepisa', claim: 'Tvrdnja', role: 'Uloga izvora', unavailable: 'Pravni tekst nije dostupan za ovu referencu.', error: 'Anotacije nije moguće učitati.', changed: 'Povezani odlomak izvora je promijenjen. Raniji komentar nije provjeren uz ovu verziju.', changedLabel: 'Odlomak izvora je promijenjen', previous: 'Raniji komentar — izvor je promijenjen' },
        hu: { close: 'Bezárás', notes: 'Megjegyzések ehhez a részlethez', broader: 'Bővebb megjegyzés', shared: 'Azonos megjegyzés', person: 'Személy', article: 'Cikk', legalSource: 'Jogforrás', target: 'Kapcsolódó anyag', document: 'Dokumentum megnyitása', timeline: 'Esemény megnyitása', source: 'Forrásrészlet', page: 'Oldal / részlet', pdfPage: 'PDF-oldal', transcript: 'Az átirat oldalszámozása', claim: 'Állítás', role: 'A forrás szerepe', unavailable: 'Ehhez a hivatkozáshoz nem érhető el a jogszabály szövege.', error: 'A megjegyzéseket nem sikerült betölteni.', changed: 'A kapcsolt forrásrészlet megváltozott. A korábbi megjegyzést még nem ellenőriztük ehhez a változathoz.', changedLabel: 'A forrásrészlet megváltozott', previous: 'Korábbi megjegyzés — megváltozott forrás' }
    };
    function annotationRole(value, culture) {
        var roles = {
            'civil_register': ['Civil register', 'Matična evidencija', 'Anyakönyvi nyilvántartás'],
            'court_record': ['Court record', 'Sudski spis', 'Bírósági irat'],
            'court-record': ['Court record', 'Sudski spis', 'Bírósági irat'],
            'author-correspondence': ['Author’s correspondence', 'Autorova prepiska', 'A szerző levelezése'],
            'institutional-correspondence': ['Institutional correspondence', 'Institucionalna prepiska', 'Intézményi levelezés'],
            'party-submission': ['Party’s submission', 'Podnesak stranke', 'A fél beadványa'],
            'party-statement': ['Party’s procedural statement', 'Procesna izjava stranke', 'A fél eljárási nyilatkozata'],
            'author-analysis': ['Author’s analysis', 'Autorska analiza', 'Szerzői elemzés'],
            'author-statement': ['Author’s account', 'Autorov iskaz', 'A szerző beszámolója'],
            'author_statement': ['Author’s account', 'Autorov iskaz', 'A szerző beszámolója'],
            'social_welfare_record': ['Social welfare record', 'Spis socijalne zaštite', 'Szociális gondozási irat'],
            'forensic-claim': ['Forensic interpretation', 'Forenzičko tumačenje', 'Forenzikus értelmezés'],
            'forensic-annotation': ['Forensic comment', 'Forenzički komentar', 'Forenzikus megjegyzés'],
            'legal-mechanism': ['Legal mechanism', 'Pravni mehanizam', 'Jogi mechanizmus'],
            'expert-opinion': ['Expert opinion', 'Stručno mišljenje', 'Szakértői vélemény'],
            'primary-record': ['Primary record', 'Izvorni zapis', 'Elsődleges irat'],
            'primary-source': ['Primary source', 'Izvorni dokument', 'Elsődleges forrás'],
            'primary': ['Primary source', 'Izvorni dokument', 'Elsődleges forrás'],
            'direct-text': ['Source text', 'Tekst izvora', 'Forrásszöveg'],
            'primary-social-file': ['Original social welfare file', 'Izvorni socijalni spis', 'Eredeti szociális irat'],
            'probate-source': ['Probate record', 'Ostavinski spis', 'Hagyatéki irat'],
            'social-worker-report': ['Social worker report', 'Izvještaj socijalnog radnika', 'Szociális munkás jelentése'],
            'pedagogue-opinion': ['Pedagogue opinion', 'Mišljenje pedagoga', 'Pedagógusi vélemény'],
            'supporting-fact': ['Supporting record', 'Potkrepljujući zapis', 'Alátámasztó irat']
        };
        var labels = roles[value];
        return labels ? labels[culture === 'hr' ? 1 : culture === 'hu' ? 2 : 0] : null;
    }
    var annotationPopupNumber = 0;
    function annotationCulture(viewer) {
        var culture = viewer.getAttribute('data-culture') || document.documentElement.lang;
        return culture === 'hr' || culture === 'hu' ? culture : 'en';
    }
    function annotationElement(tag, className, text) {
        var node = document.createElement(tag);
        if (className) { node.className = className; }
        if (text !== undefined && text !== null) { node.textContent = String(text); }
        return node;
    }
    function annotationLink(parent, href, label, className) {
        if (!href) { return null; }
        var link = annotationElement('a', className || 'annotation-source-link', label);
        link.href = href; parent.appendChild(link); return link;
    }
    function renderContextPopup(viewer, group, anchor) {
        var popup = viewer.querySelector('[data-annotation-popup]');
        if (!popup || !group) { return; }
        var culture = annotationCulture(viewer), ui = annotationWords[culture];
        var card = popup.querySelector('.annotation-popup-card') || popup;
        card.replaceChildren(); annotationPopupNumber += 1;
        var close = annotationElement('button', 'annotation-popup-close', '×');
        close.type = 'button'; close.setAttribute('data-annotation-close', ''); close.setAttribute('aria-label', ui.close); card.appendChild(close);
        card.appendChild(annotationElement('div', 'annotation-popup-type', ui.notes));
        card.appendChild(annotationElement('blockquote', 'annotation-quote', group.text));
        var broader = new Map(), previous = new Map(), primaryNotes = new Map();
        group.annotations.forEach(function (annotation) {
            var section = annotationElement('section', 'annotation-comment');
            section.setAttribute('data-comment-annotation-id', String(annotation.annotationId));
            var sourceChanged = annotation.contextStatus === 'source-changed';
            var contexts = sourceChanged ? [] : annotationContexts(annotation, group.assetId, group.block, group);
            var contextLabels = contexts.map(function (context) { return context.contextLabel; }).filter(Boolean);
            section.appendChild(annotationElement('h3', '', sourceChanged ? ui.changedLabel : (Array.from(new Set(contextLabels)).join(' · ') || annotation.displayLabel || annotation.normalizedText || annotation.matchText)));
            var original = annotation.originalNote != null ? annotation.originalNote : annotation.note;
            var notes = sourceChanged ? [{ text: ui.changed, href: null }] : contexts.length ? contexts.map(function (context) {
                return { text: context.contextNote, href: context.sourceHref || '/' + culture + '/assets/' + context.sourceAssetId + '#md-L' + context.startLine };
            }) : [{ text: annotation.contextNote || annotation.fallbackContextNote || original, href: null }];
            notes.forEach(function (note) {
                if (note.text) {
                    if (primaryNotes.has(note.text)) {
                        var shared = primaryNotes.get(note.text); shared.count += 1;
                        var sharedLink = annotationLink(section, '#' + shared.id, ui.shared + ' (' + shared.count + ')'); sharedLink.setAttribute('data-annotation-shared', shared.id);
                    } else {
                        var paragraph = annotationElement('p', 'annotation-context-note', note.text);
                        paragraph.id = 'annotation-note-' + annotationPopupNumber + '-' + primaryNotes.size;
                        section.appendChild(paragraph); primaryNotes.set(note.text, { id: paragraph.id, count: 1 });
                    }
                }
                if (note.href) { annotationLink(section, note.href, ui.source); }
            });
            var showOriginal = !contexts.length || contexts.some(function (context) { return context.showOriginalNote; });
            if (sourceChanged && original) {
                if (!previous.has(original)) { previous.set(original, []); }
                previous.get(original).push(annotation.displayLabel || annotation.matchText);
            } else if (showOriginal && original && !notes.some(function (note) { return note.text === original; })) {
                if (!broader.has(original)) { broader.set(original, []); }
                broader.get(original).push(annotation.displayLabel || annotation.matchText);
            }
            var meta = annotationElement('dl', 'annotation-popup-meta');
            function field(label, text) { if (text) { var row = annotationElement('div'); row.appendChild(annotationElement('dt', '', label)); row.appendChild(annotationElement('dd', '', text)); meta.appendChild(row); } }
            var people = sourceChanged ? [] : contexts.length ? contexts.map(function (context) { return context.contextPersonKey ? context.contextPersonName : null; }).filter(Boolean) : [annotation.personName].filter(Boolean);
            var personKeys = contexts.length ? contexts.map(function (context) { return context.contextPersonKey; }).filter(Boolean) : [annotation.personKey].filter(Boolean);
            if (personKeys.length) { section.setAttribute('data-person-key', Array.from(new Set(personKeys)).join(' ')); }
            if (annotation.claimKey) { section.setAttribute('data-claim-key', annotation.claimKey); }
            if (annotation.sourceRole) { section.setAttribute('data-source-role', annotation.sourceRole); }
            field(ui.role, annotationRole(annotation.sourceRole, culture));
            field(ui.person, Array.from(new Set(people)).join(' · '));
            var pageLabel = /\bPDF\b/iu.test(annotation.pageHint || '') ? ui.pdfPage : annotation.documentKey === 'divorce-proceedings-p-1642-76' ? ui.transcript : ui.page;
            field(pageLabel, annotation.pageHint);
            if (annotation.lawArticleNumber || annotation.lawKey) {
                var row = annotationElement('div'); row.appendChild(annotationElement('dt', '', annotation.lawArticleNumber ? ui.article : ui.legalSource)); var target = annotationElement('dd');
                var label = annotation.lawArticleNumber ? (culture === 'hu' ? annotation.lawArticleNumber + '. cikk' : ui.article + ' ' + annotation.lawArticleNumber) : '';
                var lawLabel = annotation.lawLinkLabel || (annotation.lawTitle ? annotation.lawTitle + ' · ' : '') + label;
                if (annotation.lawKey && annotation.canOpenLawArticle && annotation.lawArticleHref) {
                    var lawLink = annotationLink(target, annotation.lawArticleHref, lawLabel);
                    lawLink.classList.add('law-ref');
                    lawLink.setAttribute('data-law-source', annotation.lawSource || 'historical');
                    lawLink.setAttribute('data-law-key', annotation.lawKey); lawLink.setAttribute('data-law-article', annotation.lawArticleNumber || ''); lawLink.setAttribute('data-law-lang', culture);
                    lawLink.setAttribute('data-law-article-href', annotation.lawArticleHref);
                } else {
                    var lawSource = annotationElement('span', 'law-source-label', lawLabel);
                    lawSource.setAttribute('data-law-source', annotation.lawSource || 'historical'); target.appendChild(lawSource);
                    target.appendChild(annotationElement('small', 'law-source-unavailable', ui.unavailable));
                }
                row.appendChild(target); meta.appendChild(row);
            }
            if (annotation.targetDocumentUrl || annotation.targetTimelineUrl) {
                var row = annotationElement('div'); row.appendChild(annotationElement('dt', '', ui.target)); var target = annotationElement('dd');
                annotationLink(target, annotation.targetDocumentUrl, ui.document); annotationLink(target, annotation.targetTimelineUrl, ui.timeline);
                row.appendChild(target); meta.appendChild(row);
            }
            if (meta.childNodes.length) { section.appendChild(meta); }

            card.appendChild(section);
        });
        function appendBroaderComments(comments, label) {
            comments.forEach(function (labels, note) {
                var details = annotationElement('details', 'annotation-broader-comment'); details.appendChild(annotationElement('summary', '', label + (labels.length > 1 ? ' (' + labels.length + ')' : '')));
                details.appendChild(annotationElement('p', '', labels.join(' · '))); details.appendChild(annotationElement('p', '', note)); card.appendChild(details);
            });
        }
        appendBroaderComments(broader, ui.broader);
        appendBroaderComments(previous, ui.previous);
        popup.hidden = false; popup.classList.add('is-open'); popup.__originAnchor = anchor;
        if (anchor) { popup.style.setProperty('--annotation-anchor-top', Math.max(16, anchor.getBoundingClientRect().top + window.scrollY + 24) + 'px'); }
    }
    function closePopup(viewer) {
        var popup = viewer.querySelector('[data-annotation-popup]');
        if (!popup) {
            return;
        }

        popup.hidden = true;
        popup.classList.remove('is-open');
        if (popup.__originAnchor && popup.__originAnchor.isConnected && popup.__originAnchor.getClientRects().length) { popup.__originAnchor.focus({ preventScroll: true }); }
    }

    function initAnnotationEvents(viewer) {
        viewer.addEventListener('click', function (event) {
            var close = event.target.closest('[data-annotation-close]');
            if (close) {
                closePopup(viewer);
                return;
            }

            var shared = event.target.closest('[data-annotation-shared]');
            if (shared) {
                event.preventDefault();
                var note = document.getElementById(shared.getAttribute('data-annotation-shared'));
                if (note) { note.scrollIntoView({ block: 'nearest' }); }
                return;
            }
            var hit = event.target.closest('.annotation-hit');
            if (!hit || !viewer.contains(hit)) {
                return;
            }

            renderContextPopup(viewer, hit.__originAnnotationGroup, hit);
        });

        viewer.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                closePopup(viewer);
                return;
            }

            if (event.key !== 'Enter' && event.key !== ' ') {
                return;
            }

            var hit = event.target.closest('.annotation-hit');
            if (!hit || !viewer.contains(hit)) {
                return;
            }

            event.preventDefault();
            renderContextPopup(viewer, hit.__originAnnotationGroup, hit);
        });
    }

    function loadAnnotations(viewer) {
        var seed = viewer.querySelector('[data-annotation-source]');
        if (seed) {
            try {
                var embedded = JSON.parse(seed.textContent || '[]');
                if (Array.isArray(embedded)) { return Promise.resolve(embedded); }
            } catch (error) { console.warn('[OriginDossier] Annotation seed could not be read', error); }
        }
        var url = viewer.getAttribute('data-annotations-url');
        if (!url) {
            return Promise.resolve([]);
        }

        return fetch(url, { headers: { 'Accept': 'application/json' } })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('Annotation request failed: ' + response.status);
                }
                return response.json();
            })
            .then(function (annotations) {
                if (!Array.isArray(annotations)) { throw new Error('Invalid annotation response.'); }
                var status = viewer.querySelector('[data-annotation-status]');
                if (status) { status.hidden = true; }
                return annotations;
            })
            .catch(function (error) {
                console.warn('[OriginDossier] Annotation load failed', error);
                showAnnotationError(viewer);
                return [];
            });
    }

    function initMarkdownViewers() {
        var viewers = document.querySelectorAll('[data-markdown-viewer]');
        if (!viewers.length) {
            return;
        }

        viewers.forEach(function (viewer) {
            if (viewer.getAttribute('data-markdown-enhanced') === 'true') { return; }
            var serverRendered = viewer.getAttribute('data-markdown-rendered') === 'server';
            if (!serverRendered && typeof window.markdownit !== 'function') { return; }
            var sourceNode = viewer.querySelector('[data-markdown-source]');
            var annotatedNode = viewer.querySelector('[data-markdown-annotated]');
            var htmlNode = viewer.querySelector('[data-markdown-html]');
            var rawNode = viewer.querySelector('[data-markdown-raw]');
            var buttons = viewer.querySelectorAll('[data-mode]');

            if (!sourceNode || !htmlNode || !rawNode || !buttons.length) {
                return;
            }

            var rawText = '';
            try {
                rawText = JSON.parse(sourceNode.textContent || '""');
            } catch (error) {
                rawText = sourceNode.textContent || '';
            }

            var md = serverRendered ? null : window.markdownit({
                html: true,
                linkify: true,
                typographer: false,
                breaks: true
            });

            if (serverRendered) {
                if (annotatedNode) {
                    htmlNode.innerHTML = annotatedNode.innerHTML;
                    htmlNode.querySelectorAll('[id]').forEach(function (node) {
                        if (/^md-L\d+$/.test(node.id)) { node.id = node.id.replace('md-L', 'md-clean-L'); }
                    });
                }
            } else {
                var rendered = renderMarkdownWithSources(md, rawText, 'md-L');
                htmlNode.innerHTML = annotatedNode ? renderMarkdownWithSources(md, rawText, 'md-clean-L') : rendered;
                if (annotatedNode) { annotatedNode.innerHTML = rendered; }
            }
            rawNode.textContent = rawText;

            if (annotatedNode) {
                loadAnnotations(viewer).then(function (annotations) {
                    applyAnnotations(annotatedNode, annotations || []);
                });
            }

            initAnnotationEvents(viewer);

            function setMode(mode) {
                buttons.forEach(function (btn) {
                    btn.classList.toggle('is-active', btn.getAttribute('data-mode') === mode);
                });

                if (annotatedNode) {
                    annotatedNode.hidden = mode !== 'annotated';
                }
                htmlNode.hidden = mode !== 'html';
                rawNode.hidden = mode !== 'md';
                closePopup(viewer);
            }

            buttons.forEach(function (btn) {
                btn.addEventListener('click', function () {
                    setMode(btn.getAttribute('data-mode'));
                });
            });

            setMode(annotatedNode ? 'annotated' : 'html');
            var toolbar = viewer.querySelector('.asset-markdown-toolbar');
            if (toolbar) { toolbar.hidden = false; toolbar.style.removeProperty('display'); }
            viewer.setAttribute('data-markdown-enhanced', 'true');
            window.requestAnimationFrame(scrollSourceAnchor);
        });
    }

    function renderMarkdownWithSources(md, text, prefix) {
        var environment = {}, tokens = md.parse(String(text || ''), environment), ids = new Set();
        tokens.forEach(function (token) {
            if (!token.block || !token.map || token.nesting !== 1) { return; }
            var line = token.map[0] + 1;
            token.attrSet('data-source-line', String(line)); token.attrSet('data-source-end-line', String(token.map[1]));
            var id = (prefix || 'md-L') + line;
            if (!ids.has(id) && !token.attrGet('id')) { token.attrSet('id', id); ids.add(id); }
        });
        return md.renderer.render(tokens, md.options, environment);
    }
    function findSourceAnchor(hash) {
        var id;
        try { id = decodeURIComponent(String(hash || '').replace(/^#/, '')); } catch (error) { return null; }
        var direct = document.getElementById(id), match = /^md-L(\d+)$/.exec(id);
        if (!match) { return null; }
        if (direct && direct.getClientRects().length) { return direct; }
        var line = Number(match[1]);
        var candidates = Array.from(document.querySelectorAll('[data-source-line]')).filter(function (node) {
            return node.getClientRects().length && Number(node.getAttribute('data-source-line')) <= line && Number(node.getAttribute('data-source-end-line') || node.getAttribute('data-source-line')) >= line;
        });
        candidates.sort(function (a, b) {
            return Number(a.getAttribute('data-source-end-line')) - Number(a.getAttribute('data-source-line')) - (Number(b.getAttribute('data-source-end-line')) - Number(b.getAttribute('data-source-line')));
        });
        return candidates[0] || null;
    }
    function scrollSourceAnchor() {
        var target = findSourceAnchor(window.location.hash);
        if (!target) { return; }
        var navigation = document.querySelector('.mainnav'); var position = navigation && window.getComputedStyle(navigation).position;
        var offset = navigation && (position === 'sticky' || position === 'fixed') ? navigation.getBoundingClientRect().height : 0;
        window.scrollTo({ top: Math.max(0, target.getBoundingClientRect().top + window.scrollY - offset - 16), behavior: 'auto' });
    }
    function showAnnotationError(viewer) {
        var status = viewer.querySelector('[data-annotation-status]');
        if (!status) {
            status = annotationElement('p', 'annotation-load-status'); status.setAttribute('data-annotation-status', ''); status.setAttribute('role', 'alert');
            var toolbar = viewer.querySelector('.asset-markdown-toolbar'); if (toolbar) { toolbar.after(status); } else { viewer.prepend(status); }
        }
        status.textContent = annotationWords[annotationCulture(viewer)].error; status.hidden = false;
    }
    window.addEventListener('hashchange', function () { window.requestAnimationFrame(scrollSourceAnchor); });
    OD.safeParse = safeParse;
    OD.initMarkdownViewers = initMarkdownViewers;
    OD.annotationTools = { makeRegex: makeAnnotationRegex, normalizeAnnotation: extendedAnnotation, applyAnnotations: applyBlockAnnotations, renderMarkdownWithSources: renderMarkdownWithSources, findSourceAnchor: findSourceAnchor, selectContexts: annotationContexts };
})(window, document);





