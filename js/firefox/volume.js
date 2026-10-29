// Firefox version of FullscreenPlus volume boosting.
// Runs in the ISOLATED world of each permitted page/frame.
// Unlike Chromium tabCapture, this boosts HTML <video>/<audio> elements only.

let currentVolumeBoost = 100;
const processedMedia = new WeakMap();
const observedRoots = new WeakSet();
const failedMedia = new WeakSet();


function canSafelyProcess(media) {
    const url = media.currentSrc || media.src;
    if (!url && !media.srcObject) return false;

    // MediaElementAudioSourceNode can output silence for a cross-origin
    // resource that was fetched without CORS. Do not force a reload or
    // change crossorigin: either operation can break a site's player.
    if (url && /^https?:/i.test(url)) {
        try {
            const mediaOrigin = new URL(url, document.baseURI).origin;
            if (mediaOrigin !== location.origin && !media.crossOrigin) {
                return false;
            }
        } catch (_) {
            return false;
        }
    }

    return true;
}


function resumeContext(audioCtx) {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
    }
}


function configureRoute(state, percentage) {
    const boosted = percentage > 100;

    // At <=100%, bypass the filter/compressor for normal audio.
    // Keep the MediaElementAudioSourceNode alive: creating a second one
    // for the same HTMLMediaElement would throw InvalidStateError.
    if (boosted !== state.boosted) {
        state.source.disconnect();
        state.source.connect(boosted ? state.highPassFilter : state.audioCtx.destination);
        state.boosted = boosted;
    }

    if (boosted) {
        state.gainNode.gain.value = percentage / 100;
    }
    resumeContext(state.audioCtx);
}


function setupAudioBoost(media) {
    if (failedMedia.has(media)) return;

    const existing = processedMedia.get(media);
    if (existing) {
        configureRoute(existing, currentVolumeBoost);
        return;
    }

    // Don't touch the page's media until boosting is enabled.
    if (currentVolumeBoost <= 100 || !canSafelyProcess(media)) return;

    let audioCtx;
    let source;

    try {
        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) return;

        audioCtx = new AudioContextCtor();
        source = audioCtx.createMediaElementSource(media);

        const highPassFilter = audioCtx.createBiquadFilter();
        highPassFilter.type = 'highpass';
        highPassFilter.frequency.value = 35;
        highPassFilter.Q.value = 0.7;

        const gainNode = audioCtx.createGain();
        gainNode.gain.value = currentVolumeBoost / 100;

        const compressor = audioCtx.createDynamicsCompressor();
        compressor.threshold.value = -1;
        compressor.knee.value = 6;
        compressor.ratio.value = 20;
        compressor.attack.value = 0.001;
        compressor.release.value = 0.15;

        highPassFilter.connect(gainNode);
        gainNode.connect(compressor);
        compressor.connect(audioCtx.destination);
        source.connect(highPassFilter);

        processedMedia.set(media, {
            audioCtx,
            source,
            highPassFilter,
            gainNode,
            boosted: true
        });

        resumeContext(audioCtx);
    } catch (error) {
        console.warn('[FullscreenPlus] Cannot boost this media element:', error);
        // Once createMediaElementSource() succeeds, the element must remain
        // connected to that context. Route it straight to the speakers if
        // later graph setup fails, so the page keeps making sound.
        if (audioCtx && source) {
            try {
                source.disconnect();
                source.connect(audioCtx.destination);
                resumeContext(audioCtx);
            } catch (routingError) {
                console.error('[FullscreenPlus] Audio recovery failed:', routingError);
            }
            failedMedia.add(media);
        } else if (audioCtx) {
            audioCtx.close().catch(() => {});
        }
    }
}


function scanTree(root) {
    if (root instanceof HTMLMediaElement) {
        setupAudioBoost(root);
    }
    if (root.shadowRoot) {
        observeRoot(root.shadowRoot);
        scanTree(root.shadowRoot);
    }
    if (typeof root.querySelectorAll !== 'function') return;

    for (const element of root.querySelectorAll('*')) {
        if (element instanceof HTMLMediaElement) {
            setupAudioBoost(element);
        }
        if (element.shadowRoot) {
            observeRoot(element.shadowRoot);
            scanTree(element.shadowRoot);
        }
    }
}


function observeRoot(root) {
    if (observedRoots.has(root)) return;
    observedRoots.add(root);

    const observer = new MutationObserver(records => {
        if (currentVolumeBoost <= 100) return;
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) scanTree(node);
            }
        }
    });
    observer.observe(root, { childList: true, subtree: true });

    const onMediaEvent = event => {
        if (event.target instanceof HTMLMediaElement) {
            if (currentVolumeBoost > 100 || processedMedia.has(event.target)) {
                setupAudioBoost(event.target);
            }
        }
    };
    root.addEventListener('loadedmetadata', onMediaEvent, true);
    root.addEventListener('play', onMediaEvent, true);

    // Helps unlock suspended AudioContexts after an actual page interaction.
    const onUserGesture = () => {
        if (currentVolumeBoost > 100) scanTree(root);
    };
    root.addEventListener('pointerdown', onUserGesture, true);
    root.addEventListener('keydown', onUserGesture, true);
}

function applyVolumeBoost(percentage) {
    const next = Number(percentage);
    if (!Number.isFinite(next) || next < 0 || next > 1000) return;
    currentVolumeBoost = next;
    scanTree(document);
}

// Commands come from Firefox's background event page.
browser.runtime.onMessage.addListener(request => {
    if (request?.type === 'firefox-volume-apply') {
        applyVolumeBoost(request.volume);
        return Promise.resolve({ success: true });
    }
    return undefined;
});

// Content scripts are recreated on navigation. Restore any existing per-tab
// boost value without requiring the popup to be reopened.
browser.runtime.sendMessage({ type: 'firefox-volume-get-for-frame' })
    .then(response => {
        if (response?.success) applyVolumeBoost(response.volume);
    })
    .catch(() => {});

observeRoot(document);
