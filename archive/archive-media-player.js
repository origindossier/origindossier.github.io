(function () {
    let player = null;
    let captionLayerInitialized = false;
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
            btn.className = 'od-cue'; btn.style.font = 'inherit'; btn.style.lineHeight = '1.6';
            btn.dataset.index = String(index);
            btn.dataset.start = String(cue.start);

            btn.innerHTML =
                `<span class="od-cue-time">${formatTime(cue.start)}</span>` +
                `<span class="od-cue-text">${escapeHtml(cue.text)}</span>`;

            btn.addEventListener('click', function () {
                if (player && typeof player.seekTo === 'function') {
                    player.seekTo(cue.start, true);
                    player.playVideo();
                } else {
                    currentCueIndex = index;
                    updateLiveCaption(index);
                    highlightTranscriptCue(index);
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
        if (window.ODArchive) return;
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
        if (captionLayerInitialized) return;
        captionLayerInitialized = true;
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

                    document.querySelector('.od-player-controls').style.display = '';
                    document.getElementById('archive-video-start')?.remove();
                    initializePlayerUi();
                    startCaptionSync();
                },
                onError: function (event) {
                    document.getElementById('archive-video-status').textContent = archiveLabels.failed + ' (' + event.data + ')';
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

    window.addEventListener('beforeunload', function () {
        stopCaptionSync();
        stopPlayerUiLoop();
    });
    // Static edition: captions always work locally; YouTube is loaded only on request.
    const archiveLanguage = document.documentElement.lang || 'en';
    const archiveLabels = ({
        en: {play:'Play video (internet)',external:'Open on YouTube',download:'Download captions',loading:'Connecting to YouTube…',failed:'YouTube could not play here. Use “Open on YouTube”.',local:'The transcript and captions work offline. To watch from a local file, open YouTube.',offline:'No internet connection. The transcript and captions remain available.'},
        hr: {play:'Pokreni video (internet)',external:'Otvori na YouTubeu',download:'Preuzmi titlove',loading:'Povezivanje s YouTubeom…',failed:'YouTube se ovdje nije mogao pokrenuti. Koristite „Otvori na YouTubeu”.',local:'Prijepis i titlovi rade izvan mreže. Za gledanje iz lokalne datoteke otvorite YouTube.',offline:'Nema internetske veze. Prijepis i titlovi ostaju dostupni.'},
        hu: {play:'Videó lejátszása (internet)',external:'Megnyitás a YouTube-on',download:'Feliratok letöltése',loading:'Kapcsolódás a YouTube-hoz…',failed:'A YouTube itt nem tudta lejátszani a videót. Használja a „Megnyitás a YouTube-on” gombot.',local:'Az átirat és a feliratok offline is működnek. Helyi fájlból a videót a YouTube-on nyithatja meg.',offline:'Nincs internetkapcsolat. Az átirat és a feliratok továbbra is elérhetők.'}
    })[archiveLanguage] || {play:'Play video (internet)',external:'Open on YouTube',download:'Download captions',loading:'Connecting to YouTube…',failed:'Open on YouTube',local:'Open on YouTube',offline:'No internet connection'};
    const archiveVideoHost = document.getElementById('od-youtube-player');
    if (archiveVideoHost) {
        const frame = document.getElementById('od-media-frame');
        const actions = document.createElement('div');actions.className='hero-actions';actions.setAttribute('data-archive-media-actions','');
        const start = document.createElement('button');start.type='button';start.id='archive-video-start';start.className='btn btn-primary';start.textContent=archiveLabels.play;
        const external = document.createElement('a');external.className='btn btn-secondary';external.href='https://www.youtube.com/watch?v='+encodeURIComponent(archiveVideoHost.dataset.videoId);external.target='_blank';external.rel='noopener noreferrer';external.textContent=archiveLabels.external;external.id='archive-youtube-link';
        const status = document.createElement('p');status.id='archive-video-status';status.setAttribute('role','status');
        actions.append(external);frame.before(actions,status);
        archiveVideoHost.textContent='';archiveVideoHost.append(start);
        const track = document.getElementById('od-captions-panel')?.dataset.defaultTrack;
        if(track){const download=document.createElement('a');download.href=track;download.download='';download.className='btn btn-secondary';download.textContent=archiveLabels.download;actions.append(download);}
        if(location.protocol==='file:'){start.hidden=true;status.textContent=archiveLabels.local;archiveVideoHost.textContent=archiveLabels.local;}
        let loading=false;
        start.addEventListener('click',function(){
            if(!navigator.onLine){status.textContent=archiveLabels.offline;return;}
            if(loading)return;loading=true;start.disabled=true;status.textContent=archiveLabels.loading;
            if(window.YT?.Player){window.onYouTubeIframeAPIReady();return;}
            const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';script.id='archive-youtube-api';
            script.onerror=()=>{status.textContent=archiveLabels.failed;start.disabled=false;loading=false;script.remove();};
            document.head.append(script);
        });
        const originalReady=window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady=function(){status.textContent='';archiveVideoHost.removeAttribute('style');originalReady();};
        initializeCaptionLayer();
    }

})();