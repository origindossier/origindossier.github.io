(function () {
    'use strict';

    var modeStorageKey = 'originDossier.reader.v1';
    var stateStorageKey = 'originDossier.reader.state';

    function readStorage(storageName, key) {
        try {
            return window[storageName].getItem(key);
        } catch (error) {
            return null;
        }
    }

    function writeStorage(storageName, key, value) {
        try {
            window[storageName].setItem(key, value);
        } catch (error) {
            // The reader also works when browser storage is unavailable.
        }
    }

    function parseJson(text, fallback) {
        try {
            return JSON.parse(text);
        } catch (error) {
            return fallback;
        }
    }

    function dateTime(value) {
        if (!value) {
            return NaN;
        }
        // Use calendar dates in UTC so a time zone cannot change the quarter.
        var datePart = String(value).slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(datePart)
            ? Date.parse(datePart + 'T00:00:00Z')
            : NaN;
    }

    function calendarDate(year, month, day) {
        return Date.UTC(year, month, day);
    }

    function initReader(root, readerIndex) {
        var dataNode = root.querySelector('script[data-timeline-data]');
        var labelsNode = root.querySelector('script[data-reader-labels]');
        var chronology = root.querySelector('[data-reader-chronology]');
        var parallel = root.querySelector('[data-reader-parallel]');
        var panel = root.querySelector('[data-reader-panel]');
        var panelContent = root.querySelector('[data-reader-panel-content]');
        if (!dataNode || !chronology || !parallel || !panel || !panelContent) {
            return;
        }

        var parsed = parseJson(dataNode.textContent || '[]', []);
        var data = Array.isArray(parsed) ? parsed : parsed && parsed.records;
        if (!Array.isArray(data)) {
            return;
        }
        var labels = parseJson(labelsNode ? labelsNode.textContent : '{}', {}) || {};
        var entryNodes = new Map();
        root.querySelectorAll('details[data-reader-entry]').forEach(function (entry) {
            entryNodes.set(entry.getAttribute('data-reader-entry'), entry);
        });
        var records = data.filter(function (record) {
            return record && record.key && entryNodes.has(String(record.key));
        }).map(function (record, index) {
            var start = dateTime(record.sortDate);
            var end = dateTime(record.endDate);
            var filterStart = dateTime(record.filterStart);
            var filterEnd = dateTime(record.filterEnd);
            var yearSpan = /^\d{4}\s*[\u2013\u2014-]\s*\d{4}$/.test(String(record.dateLabel || '').trim());
            return {
                key: String(record.key),
                entryKey: record.entryKey ? String(record.entryKey) : '',
                title: record.title == null ? '' : String(record.title),
                dateLabel: record.dateLabel == null ? '' : String(record.dateLabel),
                process: record.process ? String(record.process) : 'other',
                processLabel: record.processLabel == null ? '' : String(record.processLabel),
                start: start,
                end: end,
                filterStart: Number.isFinite(filterStart) ? filterStart : start,
                filterEnd: Number.isFinite(filterEnd) ? filterEnd : Number.isFinite(end) ? end : start,
                datePrecision: String(record.datePrecision || '').toLowerCase(),
                approximate: record.isApproximateDate === true,
                yearSpan: yearSpan,
                hasDateRange: typeof record.hasDateRange === 'boolean'
                    ? record.hasDateRange : Number.isFinite(end) || yearSpan,
                order: index
            };
        });
        if (data.length && !records.length) {
            return;
        }

        var recordByKey = new Map();
        records.forEach(function (record) {
            recordByKey.set(record.key, record);
        });
        function findRecord(key) {
            if (!key) {
                return null;
            }
            key = String(key);
            return recordByKey.get(key) || records.find(function (record) {
                return record.entryKey === key;
            }) || null;
        }

        var modeButtons = Array.from(root.querySelectorAll('[data-reader-mode]'));
        var periodButtons = Array.from(root.querySelectorAll('[data-reader-period]'));
        var yearSelect = root.querySelector('select[data-reader-year]');
        var processSelect = root.querySelector('select[data-reader-process]');
        var count = root.querySelector('[data-reader-count]');
        var empty = root.querySelector('[data-reader-empty]');
        var closeButton = root.querySelector('[data-reader-close]');
        var expandButton = root.querySelector('[data-reader-expand]');
        var placeholder = panelContent.cloneNode(true);
        var visibleRecords = [];
        var lastTrigger = null;
        var panelKey = null;
        var state = {
            mode: 'chronology',
            period: 'all',
            year: 'all',
            process: 'all',
            selected: null,
            detailOpen: false
        };

        if (!panel.id) {
            panel.id = 'timeline-reader-panel-' + readerIndex;
        }
        panel.setAttribute('tabindex', '-1');
        if (count) {
            count.setAttribute('aria-live', 'polite');
        }
        entryNodes.forEach(function (entry) {
            var summary = entry.querySelector('[data-reader-select]');
            if (summary) {
                summary.setAttribute('aria-controls', panel.id);
            }
            // Without this enhancement, the server-rendered details stay usable.
            entry.open = false;
        });

        function validMode(value) {
            return value === 'parallel' || value === 'chronology';
        }
        function validOption(select, value) {
            return value === 'all' || (select && Array.from(select.options).some(function (option) {
                return option.value === value;
            }));
        }
        function validPeriod(value) {
            return value === 'all' || periodButtons.some(function (button) {
                return button.getAttribute('data-reader-period') === value;
            });
        }
        var storedMode = readStorage('localStorage', modeStorageKey);
        if (!validMode(storedMode)) {
            var storedModeObject = parseJson(storedMode, null);
            storedMode = storedModeObject && storedModeObject.mode;
        }
        if (validMode(storedMode)) {
            state.mode = storedMode;
        }
        var stored = parseJson(readStorage('sessionStorage', stateStorageKey), null);
        if (stored && typeof stored === 'object') {
            if (validMode(stored.mode)) {
                state.mode = stored.mode;
            }
            if (typeof stored.period === 'string' && validPeriod(stored.period)) {
                state.period = stored.period;
            }
            if (typeof stored.year === 'string' && validOption(yearSelect, stored.year)) {
                state.year = stored.year;
            }
            if (typeof stored.process === 'string' && validOption(processSelect, stored.process)) {
                state.process = stored.process;
            }
            var storedRecord = findRecord(stored.selected);
            state.selected = storedRecord ? storedRecord.key : null;
            state.detailOpen = !!storedRecord && stored.detailOpen === true;
        }

        function syncSelectionQuery(selectedRecord) {
            try {
                var currentUrl = new URL(window.location.href);
                if (selectedRecord) {
                    currentUrl.searchParams.set('timeline', selectedRecord.entryKey || selectedRecord.key);
                } else {
                    currentUrl.searchParams.delete('timeline');
                }
                // Keep a record hash in step with manual selection; section hashes stay intact.
                if (findRecord(decodeURIComponent(currentUrl.hash.slice(1)))) {
                    currentUrl.hash = selectedRecord ? selectedRecord.key : 'timeline';
                }
                window.history.replaceState(window.history.state, '', currentUrl.href);
                // Language links were rendered before a filter or selection changed.
                document.querySelectorAll('.lang-switch a[href]').forEach(function (link) {
                    var linkUrl = new URL(link.getAttribute('href'), window.location.href);
                    if (selectedRecord) {
                        linkUrl.searchParams.set('timeline', selectedRecord.entryKey || selectedRecord.key);
                    } else {
                        linkUrl.searchParams.delete('timeline');
                    }
                    link.setAttribute('href', linkUrl.pathname + linkUrl.search + linkUrl.hash);
                });
            } catch (error) {
                // Session state still preserves the selection if URL updates are unavailable.
            }
        }

        function saveState(event) {
            var selectedRecord = findRecord(state.selected);
            if (!event || event.type !== 'pagehide') {
                syncSelectionQuery(selectedRecord);
            }
            writeStorage('localStorage', modeStorageKey, state.mode);
            writeStorage('sessionStorage', stateStorageKey, JSON.stringify({
                mode: state.mode,
                period: state.period,
                year: state.year,
                process: state.process,
                selected: selectedRecord ? selectedRecord.entryKey || selectedRecord.key : null,
                detailOpen: !!selectedRecord && state.detailOpen
            }));
        }

        var OD = window.OriginDossier = window.OriginDossier || {};
        OD.captureCurrentTimelineState = saveState;

        function filterBounds() {
            var start = -Infinity;
            var end = Infinity;
            var periodMatch = /^(\d{4})-(\d{4})$/.exec(state.period);
            if (periodMatch) {
                start = calendarDate(Number(periodMatch[1]), 0, 1);
                end = calendarDate(Number(periodMatch[2]), 11, 31);
            }
            if (/^\d{4}$/.test(state.year)) {
                var year = Number(state.year);
                start = Math.max(start, calendarDate(year, 0, 1));
                end = Math.min(end, calendarDate(year, 11, 31));
            }
            return { start: start, end: end };
        }

        function matches(record, bounds) {
            if (state.process !== 'all' && record.process !== state.process) {
                return false;
            }
            if (!Number.isFinite(record.filterStart)) {
                return bounds.start === -Infinity && bounds.end === Infinity;
            }
            var end = Number.isFinite(record.filterEnd)
                ? Math.max(record.filterStart, record.filterEnd) : record.filterStart;
            return bounds.start <= bounds.end && record.filterStart <= bounds.end && end >= bounds.start;
        }

        function navigationTarget() {
            try {
                var url = new URL(window.location.href);
                var hash = decodeURIComponent(url.hash.slice(1));
                var hashRecord = findRecord(hash);
                return {
                    record: hashRecord || findRecord(url.searchParams.get('timeline')),
                    reveal: !hash || hash === 'timeline' || !!hashRecord
                };
            } catch (error) {
                return { record: null, reveal: false };
            }
        }

        function applyNavigationSelection(record) {
            if (state.selected !== record.key) {
                state.detailOpen = false;
            }
            state.selected = record.key;
            // Preserve every filter that can still contain the requested event.
            if (state.process !== 'all' && state.process !== record.process) {
                state.process = 'all';
            }
            var periodMatch = /^(\d{4})-(\d{4})$/.exec(state.period);
            if (periodMatch && !matches(record, {
                start: calendarDate(Number(periodMatch[1]), 0, 1),
                end: calendarDate(Number(periodMatch[2]), 11, 31)
            })) {
                state.period = 'all';
            }
            if (/^\d{4}$/.test(state.year) && !matches(record, {
                start: calendarDate(Number(state.year), 0, 1),
                end: calendarDate(Number(state.year), 11, 31)
            })) {
                state.year = 'all';
            }
            if (!matches(record, filterBounds())) {
                state.period = 'all';
            }
        }

        var initialTarget = navigationTarget();
        if (initialTarget.record) {
            applyNavigationSelection(initialTarget.record);
        }

        function element(tag, className, text) {
            var node = document.createElement(tag);
            if (className) {
                node.className = className;
            }
            if (text !== undefined && text !== null) {
                node.textContent = text;
            }
            return node;
        }

        function renderParallel(bounds) {
            parallel.replaceChildren();
            if (!visibleRecords.length) {
                return;
            }
            var processes = [];
            var seenProcesses = new Set();
            visibleRecords.forEach(function (record) {
                if (!seenProcesses.has(record.process)) {
                    seenProcesses.add(record.process);
                    processes.push({ key: record.process, label: record.processLabel || record.process });
                }
            });
            var processOrder = processSelect ? Array.from(processSelect.options).map(function (option) {
                return option.value;
            }) : [];
            processes.sort(function (a, b) {
                var aOrder = processOrder.indexOf(a.key);
                var bOrder = processOrder.indexOf(b.key);
                return (aOrder < 0 ? Infinity : aOrder) - (bOrder < 0 ? Infinity : bOrder);
            });
            var quarters = new Map();
            visibleRecords.forEach(function (record) {
                var start = Number.isFinite(record.filterStart) ? Math.max(record.filterStart, bounds.start) : NaN;
                var date = new Date(start);
                var year = date.getUTCFullYear();
                var quarter = Math.floor(date.getUTCMonth() / 3);
                var yearPrecision = record.datePrecision === 'year'
                    || (record.datePrecision === 'range' && !Number.isFinite(record.end) && record.yearSpan);
                var key = Number.isFinite(start) ? year + '-' + (yearPrecision ? 'year' : quarter) : 'undated';
                if (!quarters.has(key)) {
                    quarters.set(key, {
                        year: year,
                        quarter: quarter,
                        start: start,
                        sortStart: yearPrecision ? calendarDate(year, 0, 1) : start,
                        yearPrecision: yearPrecision,
                        records: []
                    });
                }
                quarters.get(key).records.push(record);
            });
            var groups = Array.from(quarters.values()).sort(function (a, b) {
                var aStart = Number.isFinite(a.sortStart) ? a.sortStart : Infinity;
                var bStart = Number.isFinite(b.sortStart) ? b.sortStart : Infinity;
                return aStart - bStart || (a.yearPrecision ? 0 : 1) - (b.yearPrecision ? 0 : 1);
            });
            var table = element('table', 'od-tl-parallel-table');
            if (labels.parallelHint) {
                table.appendChild(element('caption', '', labels.parallelHint));
            }
            var head = element('thead');
            var headRow = element('tr');
            var periodHeading = element('th', '', labels.period || '');
            periodHeading.scope = 'col';
            headRow.appendChild(periodHeading);
            processes.forEach(function (process) {
                var heading = element('th', 'od-tl-process', process.label);
                heading.scope = 'col';
                headRow.appendChild(heading);
            });
            head.appendChild(headRow);
            table.appendChild(head);
            var body = element('tbody');
            groups.forEach(function (group) {
                var row = element('tr', 'od-tl-quarter');
                var quarterHeading = element('th');
                quarterHeading.scope = 'row';
                if (Number.isFinite(group.start)) {
                    if (group.yearPrecision) {
                        quarterHeading.appendChild(element('span', 'od-tl-date', labels.yearPrecision || labels.year || ''));
                    } else {
                        var quarterLabel = Array.isArray(labels.quarterLabels) ? labels.quarterLabels[group.quarter] : '';
                        quarterHeading.appendChild(element('span', 'od-tl-date', quarterLabel || 'Q' + (group.quarter + 1)));
                    }
                    quarterHeading.appendChild(element('strong', '', String(group.year)));
                } else {
                    quarterHeading.textContent = group.records[0].dateLabel;
                }
                row.appendChild(quarterHeading);
                processes.forEach(function (process) {
                    var cell = element('td', 'od-tl-cell');
                    cell.setAttribute('data-label', process.label);
                    var cellRecords = group.records.filter(function (record) {
                        return record.process === process.key;
                    });
                    cellRecords.sort(function (a, b) {
                        var aDate = Number.isFinite(a.start) ? a.start : Infinity;
                        var bDate = Number.isFinite(b.start) ? b.start : Infinity;
                        return aDate - bDate || a.order - b.order;
                    });
                    if (!cellRecords.length) {
                        cell.appendChild(element('span', 'od-tl-no-records', labels.empty || '—'));
                    }
                    cellRecords.forEach(function (record) {
                        var button = element('button', 'od-tl-parallel-entry');
                        button.type = 'button';
                        button.setAttribute('data-reader-parallel-select', record.key);
                        button.setAttribute('aria-controls', panel.id);
                        button.appendChild(element('span', 'od-tl-date', record.dateLabel));
                        button.appendChild(element('span', 'od-tl-title', record.title));
                        if (record.filterStart < bounds.start && labels.earlier) {
                            button.appendChild(element('span', 'od-tl-badge', labels.earlier));
                        }
                        if (record.approximate && labels.approximate) {
                            button.appendChild(element('span', 'od-tl-badge', labels.approximate));
                        }
                        if (record.hasDateRange && labels.dateRange) {
                            button.appendChild(element('span', 'od-tl-badge', labels.dateRange));
                        }
                        button.appendChild(element('span', 'od-tl-process', record.processLabel || record.process));
                        cell.appendChild(button);
                    });
                    row.appendChild(cell);
                });
                body.appendChild(row);
            });
            table.appendChild(body);
            parallel.appendChild(table);
        }

        function syncDetailExpansion(record) {
            var expanded = !!record && state.detailOpen;
            root.setAttribute('data-reader-detail-open', expanded ? 'true' : 'false');
            if (expandButton) {
                expandButton.hidden = !record;
                expandButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
                var label = expanded ? labels.closeDetails : labels.openDetails;
                if (label) {
                    expandButton.textContent = label;
                }
            }
        }

        function renderPanel(record) {
            var key = record ? record.key : '';
            root.setAttribute('data-reader-open', record ? 'true' : 'false');
            syncDetailExpansion(record);
            panel.hidden = false;
            if (closeButton) {
                closeButton.hidden = !record;
            }
            if (panelKey === key) {
                return;
            }
            panelKey = key;
            panelContent.replaceChildren();
            if (!record) {
                Array.from(placeholder.childNodes).forEach(function (node) {
                    panelContent.appendChild(node.cloneNode(true));
                });
                return;
            }
            var detail = entryNodes.get(record.key).querySelector('[data-reader-detail]');
            if (detail) {
                var clone = detail.cloneNode(true);
                // Avoid duplicate DOM IDs while preserving all source link URLs and text.
                clone.removeAttribute('id');
                clone.querySelectorAll('[id]').forEach(function (node) {
                    node.removeAttribute('id');
                });
                clone.hidden = false;
                panelContent.appendChild(clone);
            }
        }

        function renderSelection() {
            entryNodes.forEach(function (entry, key) {
                var active = key === state.selected;
                if (active) {
                    entry.setAttribute('aria-current', 'true');
                } else {
                    entry.removeAttribute('aria-current');
                }
                var summary = entry.querySelector('[data-reader-select]');
                if (summary) {
                    summary.setAttribute('aria-expanded', active ? 'true' : 'false');
                    if (active) {
                        summary.setAttribute('aria-current', 'true');
                    } else {
                        summary.removeAttribute('aria-current');
                    }
                }
            });
            parallel.querySelectorAll('[data-reader-parallel-select]').forEach(function (button) {
                var active = button.getAttribute('data-reader-parallel-select') === state.selected;
                button.setAttribute('aria-expanded', active ? 'true' : 'false');
                if (active) {
                    button.setAttribute('aria-current', 'true');
                } else {
                    button.removeAttribute('aria-current');
                }
            });
            renderPanel(findRecord(state.selected));
        }

        function render() {
            var bounds = filterBounds();
            visibleRecords = records.filter(function (record) { return matches(record, bounds); });
            var visibleKeys = new Set(visibleRecords.map(function (record) { return record.key; }));
            if (state.selected && !visibleKeys.has(state.selected)) {
                state.selected = null;
                state.detailOpen = false;
            }
            root.setAttribute('data-mode', state.mode);
            chronology.hidden = state.mode !== 'chronology';
            parallel.hidden = state.mode !== 'parallel';
            modeButtons.forEach(function (button) {
                var active = button.getAttribute('data-reader-mode') === state.mode;
                button.setAttribute('aria-pressed', active ? 'true' : 'false');
                button.classList.toggle('is-active', active);
            });
            periodButtons.forEach(function (button) {
                var active = button.getAttribute('data-reader-period') === state.period;
                button.setAttribute('aria-pressed', active ? 'true' : 'false');
                button.classList.toggle('is-active', active);
            });
            if (yearSelect) {
                yearSelect.value = state.year;
            }
            if (processSelect) {
                processSelect.value = state.process;
            }
            if (count) {
                count.textContent = String(visibleRecords.length) + (labels.records ? ' ' + labels.records : '');
            }
            if (empty) {
                empty.hidden = visibleRecords.length !== 0;
            }
            entryNodes.forEach(function (entry, key) {
                entry.hidden = !visibleKeys.has(key);
            });
            chronology.querySelectorAll('[data-reader-year-group]').forEach(function (group) {
                group.hidden = !Array.from(group.querySelectorAll('details[data-reader-entry]')).some(function (entry) {
                    return !entry.hidden;
                });
            });
            renderParallel(bounds);
            renderSelection();
            saveState();
        }

        var navHeight = 0;
        function updateNavHeight() {
            var navigation = document.querySelector('.mainnav');
            var position = navigation ? window.getComputedStyle(navigation).position : '';
            navHeight = navigation && (position === 'sticky' || position === 'fixed')
                ? Math.ceil(navigation.getBoundingClientRect().height) : 0;
            root.style.setProperty('--od-tl-nav-height', navHeight + 'px');
        }

        function scrollToPanel() {
            var mobile = window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
            if (state.mode === 'parallel' || mobile) {
                var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                panel.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'instant' : 'smooth' });
            }
            panel.focus({ preventScroll: true });
        }

        function selectRecord(key, trigger) {
            var record = findRecord(key);
            if (!record || !visibleRecords.some(function (visible) { return visible.key === record.key; })) {
                return;
            }
            if (state.selected !== record.key) {
                state.detailOpen = false;
            }
            state.selected = record.key;
            lastTrigger = trigger;
            renderSelection();
            saveState();
            scrollToPanel();
        }

        function findTrigger(key) {
            if (state.mode === 'parallel') {
                return Array.from(parallel.querySelectorAll('[data-reader-parallel-select]')).find(function (button) {
                    return button.getAttribute('data-reader-parallel-select') === key;
                }) || null;
            }
            var entry = entryNodes.get(key);
            return entry ? entry.querySelector('[data-reader-select]') : null;
        }

        var revealVersion = 0;
        function cancelNavigationReveal() {
            revealVersion += 1;
        }

        function revealNavigationRecord(record) {
            var version = ++revealVersion;
            function scheduleReveal() {
                // Let the active view, selected detail and native fragment navigation settle.
                window.requestAnimationFrame(function () {
                    window.requestAnimationFrame(function () {
                        var target = navigationTarget();
                        if (version !== revealVersion || state.selected !== record.key ||
                            !target.reveal || !target.record || target.record.key !== record.key) {
                            return;
                        }
                        var trigger = findTrigger(record.key);
                        if (!trigger || !trigger.getClientRects().length) {
                            return;
                        }
                        updateNavHeight();
                        // Also reveal the event in any horizontal scroll container.
                        trigger.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
                        var clearance = navHeight + 16;
                        if (state.mode === 'parallel') {
                            var tableHead = parallel.querySelector('thead');
                            var heading = tableHead && tableHead.querySelector('th');
                            if (heading && window.getComputedStyle(heading).position === 'sticky') {
                                clearance += tableHead.getBoundingClientRect().height;
                            }
                        }
                        window.scrollBy({ top: trigger.getBoundingClientRect().top - clearance, left: 0, behavior: 'instant' });
                    });
                });
            }
            scheduleReveal();
            if (document.readyState !== 'complete') {
                window.addEventListener('load', scheduleReveal, { once: true });
            }
            if (document.fonts && document.fonts.status !== 'loaded') {
                document.fonts.ready.then(scheduleReveal);
            }
        }

        function navigateToRecord(event) {
            cancelNavigationReveal();
            var target = navigationTarget();
            // A section anchor wins even when selection state left a timeline query in the URL.
            if (!target.record || (event.type === 'hashchange' && !target.reveal)) {
                return;
            }
            applyNavigationSelection(target.record);
            render();
            if (target.reveal) {
                revealNavigationRecord(target.record);
            }
        }

        // Delayed layout work must never pull a reader back after they start navigating manually.
        ['pointerdown', 'touchstart', 'wheel', 'keydown'].forEach(function (name) {
            window.addEventListener(name, cancelNavigationReveal, { passive: true });
        });
        window.addEventListener('hashchange', navigateToRecord);
        window.addEventListener('popstate', navigateToRecord);

        root.addEventListener('click', function (event) {
            var target = event.target instanceof Element ? event.target : null;
            if (!target) {
                return;
            }
            if (target.closest('[data-reader-expand]')) {
                var expandedRecord = findRecord(state.selected);
                if (expandedRecord) {
                    state.detailOpen = !state.detailOpen;
                    syncDetailExpansion(expandedRecord);
                    saveState();
                }
                return;
            }
            var relatedLink = target.closest('[data-reader-related]');
            if (relatedLink) {
                var relatedRecord = findRecord(relatedLink.getAttribute('data-reader-related'));
                if (relatedRecord) {
                    event.preventDefault();
                    if (!matches(relatedRecord, filterBounds())) {
                        state.period = 'all';
                        state.year = 'all';
                        state.process = 'all';
                        render();
                    }

                    selectRecord(relatedRecord.key, relatedLink);
                }
                return;
            }
            var sourceLink = target.closest('a[href]');
            if (sourceLink) {
                saveState();
                return;
            }
            var modeButton = target.closest('[data-reader-mode]');
            if (modeButton) {
                var mode = modeButton.getAttribute('data-reader-mode');
                if (validMode(mode)) {
                    state.mode = mode;
                    render();
                }
                return;
            }
            var periodButton = target.closest('[data-reader-period]');
            if (periodButton) {
                state.period = periodButton.getAttribute('data-reader-period') || 'all';
                state.year = 'all';
                render();
                return;
            }
            var summary = target.closest('[data-reader-select]');
            if (summary) {
                var entry = summary.closest('details[data-reader-entry]');
                if (entry) {
                    event.preventDefault();
                    selectRecord(entry.getAttribute('data-reader-entry'), summary);
                }
                return;
            }
            var parallelButton = target.closest('[data-reader-parallel-select]');
            if (parallelButton) {
                selectRecord(parallelButton.getAttribute('data-reader-parallel-select'), parallelButton);
                return;
            }
            if (target.closest('[data-reader-close]')) {
                var previousKey = state.selected;
                state.selected = null;
                state.detailOpen = false;
                renderSelection();
                saveState();
                var trigger = lastTrigger && lastTrigger.isConnected && lastTrigger.getClientRects().length
                    ? lastTrigger : findTrigger(previousKey);
                if (trigger) {
                    trigger.focus({ preventScroll: true });
                    var triggerRect = trigger.getBoundingClientRect();
                    if (triggerRect.top < navHeight + 16 || triggerRect.bottom > window.innerHeight - 16) {
                        trigger.scrollIntoView({ block: 'nearest', behavior: 'auto' });
                    }
                }
            }
        });
        if (yearSelect) {
            yearSelect.addEventListener('change', function () {
                state.year = yearSelect.value;
                state.period = 'all';
                render();
            });
        }
        if (processSelect) {
            processSelect.addEventListener('change', function () {
                state.process = processSelect.value;
                render();
            });
        }
        window.addEventListener('pagehide', saveState);
        window.addEventListener('resize', updateNavHeight, { passive: true });
        updateNavHeight();
        root.querySelectorAll('[data-reader-controls]').forEach(function (control) {
            control.hidden = false;
        });
        root.classList.add('is-enhanced');
        root.setAttribute('data-reader-ready', 'true');
        render();
        if (initialTarget.record && initialTarget.reveal) {
            revealNavigationRecord(initialTarget.record);
        }
    }

    function init() {
        document.querySelectorAll('[data-timeline-reader]').forEach(function (root, index) {
            if (root.getAttribute('data-reader-ready') !== 'true') {
                initReader(root, index);
            }
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
}());









