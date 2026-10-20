(function () {
    let player = null;
    let currentCues = [];
    let currentCueIndex = -1;
    let captionSyncTimer = null;
    let playerUiTimer = null;

    function controlLabel(button, key, fallback) {
        return button?.dataset[key] || fallback;
    }

    function showCaptionError() {
        currentCues = [];
        currentCueIndex = -1;
        renderTranscript([]);
        const live = document.getElementById('od-captions-live');
        const panel = document.getElementById('od-captions-panel');
        if (live) live.textContent = panel?.dataset.trackError || 'The captions could not be loaded.';
    }

    function parseSrtTime(value) {
        const m = value.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
        if (!m) return NaN;

        const h = Number(m[1]);
        const min = Number(m[2]);
        const s = Number(m[3]);
        const ms = Number(m[4]);

        return h * 3600 + min * 60 + s + (ms / 1000);
    }

    function parseVttTime(value) {
        const m = value.match(/^(?:(\d{2}):)?(\d{2}):(\d{2})\.(\d{3})$/);
        if (!m) return NaN;

        const h = Number(m[1] || 0);
        const min = Number(m[2]);
        const s = Number(m[3]);
        const ms = Number(m[4]);

        return h * 3600 + min * 60 + s + (ms / 1000);
    }

    function parseSrt(text) {
        const normalized = text.replace(/\r/g, '').trim();
        if (!normalized) return [];

        const blocks = normalized.split(/\n\s*\n/);
        const cues = [];

        for (const block of blocks) {
            const lines = block.split('\n').map(x => x.trim()).filter(Boolean);
            if (lines.length < 2) continue;

            let timeLineIndex = 0;
            if (/^\d+$/.test(lines[0])) {
                timeLineIndex = 1;
            }

            const timeLine = lines[timeLineIndex];
            if (!timeLine || !timeLine.includes('-->')) continue;

            const parts = timeLine.split('-->');
            if (parts.length !== 2) continue;

            const start = parseSrtTime(parts[0].trim());
            const end = parseSrtTime(parts[1].trim());
            const cueText = lines.slice(timeLineIndex + 1).join(' ').trim();

            if (Number.isFinite(start) && Number.isFinite(end) && cueText) {
                cues.push({
                    start: start,
                    end: end,
                    text: cueText
                });
            }
        }

        return cues;
    }

    function parseVtt(text) {
        const normalized = text.replace(/\r/g, '').trim();
        if (!normalized) return [];

        const lines = normalized.split('\n');
        const cues = [];
        let i = 0;

        if (lines[0] && lines[0].startsWith('WEBVTT')) {
            i++;
        }

        while (i < lines.length) {
            while (i < lines.length && !lines[i].trim()) i++;
            if (i >= lines.length) break;

            let line = lines[i].trim();

            if (!line.includes('-->')) {
                i++;
                if (i >= lines.length) break;
                line = lines[i].trim();
            }

            if (!line.includes('-->')) {
                i++;
                continue;
            }

            const parts = line.split('-->');
            if (parts.length !== 2) {
                i++;
                continue;
            }

            const startRaw = parts[0].trim();
            const endRaw = parts[1].trim().split(/\s+/)[0];

            const start = parseVttTime(startRaw);
            const end = parseVttTime(endRaw);

            i++;

            const textLines = [];
            while (i < lines.length && lines[i].trim()) {
                textLines.push(lines[i].trim());
                i++;
            }

            const cueText = textLines.join(' ').trim();

            if (Number.isFinite(start) && Number.isFinite(end) && cueText) {
                cues.push({
                    start: start,
                    end: end,
                    text: cueText
                });
            }
        }

        return cues;
    }

    function parseCaptionText(text, url) {
        const lowerUrl = (url || '').toLowerCase();

        if (lowerUrl.endsWith('.vtt')) {
            return parseVtt(text);
        }

        if (lowerUrl.endsWith('.srt')) {
            return parseSrt(text);
        }

        if (text.trim().startsWith('WEBVTT')) {
            return parseVtt(text);
        }

        return parseSrt(text);
    }

    function formatTime(seconds) {
        const total = Math.max(0, Math.floor(seconds));
        const sec = total % 60;
        const min = Math.floor((total / 60) % 60);
        const hrs = Math.floor(total / 3600);

        if (hrs > 0) {
            return `${String(hrs).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
        }

        return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }

    function escapeHtml(value) {
        return value
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    function renderTranscript(cues) {
        const host = document.getElementById('od-captions-transcript');
        if (!host) return;

        host.innerHTML = '';

        cues.forEach((cue, index) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'od-cue';
            btn.dataset.index = String(index);
            btn.dataset.start = String(cue.start);

            btn.innerHTML =
                `<span class="od-cue-time">${formatTime(cue.start)}</span>` +
                `<span class="od-cue-text">${escapeHtml(cue.text)}</span>`;

            btn.addEventListener('click', function () {
                if (player && typeof player.seekTo === 'function') {
                    player.seekTo(cue.start, true);
                    player.playVideo();
                }
            });

            host.appendChild(btn);
        });
    }

    function updateLiveCaption(index) {
        const live = document.getElementById('od-captions-live');
        if (!live) return;

        if (index < 0 || !currentCues[index]) {
            live.textContent = '';
            return;
        }

        live.textContent = currentCues[index].text;
    }

    function highlightTranscriptCue(index) {
        const host = document.getElementById('od-captions-transcript');
        if (!host) return;

        const items = host.querySelectorAll('.od-cue');
        items.forEach(x => x.classList.remove('active'));

        if (index < 0) return;

        const active = host.querySelector(`.od-cue[data-index="${index}"]`);
        if (!active) return;

        active.classList.add('active');

        const hostRect = host.getBoundingClientRect();
        const activeRect = active.getBoundingClientRect();

        const overTop = activeRect.top < hostRect.top;
        const overBottom = activeRect.bottom > hostRect.bottom;

        if (overTop) {
            host.scrollTop -= (hostRect.top - activeRect.top) + 12;
        } else if (overBottom) {
            host.scrollTop += (activeRect.bottom - hostRect.bottom) + 12;
        }
    }

    function findCueIndexAtTime(cues, time) {
        for (let i = 0; i < cues.length; i++) {
            if (time >= cues[i].start && time <= cues[i].end) {
                return i;
            }
        }

        return -1;
    }

    function startCaptionSync() {
        stopCaptionSync();

        captionSyncTimer = window.setInterval(function () {
            if (!player || typeof player.getCurrentTime !== 'function') return;

            const t = player.getCurrentTime();
            const idx = findCueIndexAtTime(currentCues, t);

            if (idx !== currentCueIndex) {
                currentCueIndex = idx;
                updateLiveCaption(idx);
                highlightTranscriptCue(idx);
            }
        }, 200);
    }

    function stopCaptionSync() {
        if (captionSyncTimer) {
            window.clearInterval(captionSyncTimer);
            captionSyncTimer = null;
        }
    }

    function stopPlayerUiLoop() {
        if (playerUiTimer) {
            window.clearInterval(playerUiTimer);
            playerUiTimer = null;
        }
    }

    async function loadTrack(url) {
        if (!url) return;

        const response = await fetch(url, { cache: 'no-cache' });
        if (!response.ok) {
            throw new Error(`Track load failed: ${response.status}`);
        }

        const text = await response.text();

        currentCues = parseCaptionText(text, url);
        currentCueIndex = -1;

        renderTranscript(currentCues);
        updateLiveCaption(-1);
    }

    function wireTrackButtons() {
        const buttons = document.querySelectorAll('.od-caption-track');

        buttons.forEach(btn => {
            btn.addEventListener('click', async function () {
                buttons.forEach(x => x.classList.remove('active'));
                btn.classList.add('active');

                const url = btn.dataset.trackUrl;
                if (!url) return;

                try {
                    await loadTrack(url);
                } catch (err) {
                    showCaptionError();
                    console.error(err);
                }
            });
        });
    }

    function setFullscreenButtonText() {
        const btn = document.getElementById('od-media-fullscreen');
        const shell = document.getElementById('od-media-shell');
        if (!btn || !shell) return;

        btn.textContent = document.fullscreenElement === shell
            ? controlLabel(btn, 'exitFullscreen', 'Exit fullscreen')
            : controlLabel(btn, 'fullscreen', 'Fullscreen');
    }

    function wireFullscreen() {
        const shell = document.getElementById('od-media-shell');
        const btn = document.getElementById('od-media-fullscreen');

        if (!shell || !btn) return;

        btn.addEventListener('click', async function () {
            try {
                if (document.fullscreenElement !== shell) {
                    await shell.requestFullscreen();
                } else {
                    await document.exitFullscreen();
                }
            } catch (err) {
                console.error('Fullscreen failed', err);
            }
        });

        document.addEventListener('fullscreenchange', function () {
            setFullscreenButtonText();
        });

        setFullscreenButtonText();
    }

    function syncPlayPauseButton() {
        const btn = document.getElementById('od-btn-playpause');
        if (!btn || !player || typeof player.getPlayerState !== 'function') return;

        const state = player.getPlayerState();
        btn.textContent = state === YT.PlayerState.PLAYING ? controlLabel(btn, 'pause', 'Pause') : controlLabel(btn, 'play', 'Play');
    }

    function startPlayerUiLoop() {
        stopPlayerUiLoop();

        playerUiTimer = window.setInterval(function () {
            if (!player || typeof player.getCurrentTime !== 'function' || typeof player.getDuration !== 'function') {
                return;
            }

            const current = player.getCurrentTime() || 0;
            const duration = player.getDuration() || 0;

            const timeLabel = document.getElementById('od-player-time');
            const seek = document.getElementById('od-player-seek');

            if (timeLabel) {
                timeLabel.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
            }

            if (seek && duration > 0 && !seek.dataset.dragging) {
                seek.value = String(Math.floor((current / duration) * 1000));
            }
        }, 250);
    }

    function wireCopyTranscript() {
        const btn = document.getElementById('od-copy-transcript');
        if (!btn) return;

        btn.addEventListener('click', async function () {
            try {
                const text = currentCues
                    .map(c => `${formatTime(c.start)} ${c.text}`)
                    .join('\n');

                await navigator.clipboard.writeText(text);
                const oldText = btn.textContent;
                btn.textContent = controlLabel(btn, 'copied', 'Copied');
                window.setTimeout(function () {
                    btn.textContent = oldText || controlLabel(btn, 'copy', 'Copy transcript');
                }, 1500);
            } catch (err) {
                console.error(err);
            }
        });
    }

    async function initializeCaptionLayer() {
        wireTrackButtons();
        wireCopyTranscript();

        const panel = document.getElementById('od-captions-panel');
        const defaultTrack = panel ? panel.dataset.defaultTrack : null;

        if (defaultTrack) {
            try {
                await loadTrack(defaultTrack);
            } catch (err) {
                showCaptionError();
                console.error(err);
            }
        }
    }

    function initializePlayerUi() {
        wireFullscreen();

        const btnPlayPause = document.getElementById('od-btn-playpause');
        const btnMute = document.getElementById('od-btn-mute');
        const seek = document.getElementById('od-player-seek');

        if (btnPlayPause) {
            btnPlayPause.addEventListener('click', function () {
                if (!player) return;

                const state = player.getPlayerState();
                if (state === YT.PlayerState.PLAYING) {
                    player.pauseVideo();
                } else {
                    player.playVideo();
                }

                syncPlayPauseButton();
            });
        }

        if (btnMute) {
            btnMute.addEventListener('click', function () {
                if (!player) return;

                if (player.isMuted()) {
                    player.unMute();
                    btnMute.textContent = controlLabel(btnMute, 'mute', 'Mute');
                } else {
                    player.mute();
                    btnMute.textContent = controlLabel(btnMute, 'unmute', 'Unmute');
                }
            });
        }

        if (seek) {
            seek.addEventListener('input', function () {
                seek.dataset.dragging = '1';
            });

            seek.addEventListener('change', function () {
                if (!player || typeof player.getDuration !== 'function') return;

                const duration = player.getDuration() || 0;
                const ratio = Number(seek.value) / 1000;
                const target = duration * ratio;

                player.seekTo(target, true);
                delete seek.dataset.dragging;
            });
        }

        initializeCaptionLayer();
        startPlayerUiLoop();
        syncPlayPauseButton();
    }

    window.onYouTubeIframeAPIReady = function () {
        if (player || !window.YT || typeof window.YT.Player !== 'function') return;

        const host = document.getElementById('od-youtube-player');
        if (!host) return;

        const videoId = host.dataset.videoId;
        if (!videoId) return;

        player = new YT.Player('od-youtube-player', {
            videoId: videoId,
            playerVars: {
                autoplay: 0,
                controls: 0,
                disablekb: 0,
                rel: 0,
                modestbranding: 1,
                cc_load_policy: 3,
                cc_lang_pref: 'sh',
                iv_load_policy: 3,
                fs: 0,
                playsinline: 1
            },
            events: {
                onReady: function (event) {
                    try {
                        event.target.unloadModule('captions');
                        event.target.setOption('captions', 'track', {});
                        event.target.setOption('captions', 'reload', true);
                    } catch (e) {
                        console.warn('Captions disable failed', e);
                    }

                    initializePlayerUi();
                    startCaptionSync();
                },
                onStateChange: function (event) {
                    if (event.data === YT.PlayerState.PLAYING) {
                        try {
                            event.target.unloadModule('captions');
                        } catch (e) {
                        }
                    }

                    syncPlayPauseButton();
                }
            }
        });
    };

    // The API can finish before this script; its ready callback is not replayed.
    // Static archives retain their separate, explicit click-to-load bootstrap.
    if (!window.ODArchive && window.YT && typeof window.YT.Player === 'function') {
        window.onYouTubeIframeAPIReady();
    }

    window.addEventListener('beforeunload', function () {
        stopCaptionSync();
        stopPlayerUiLoop();
    });
})();