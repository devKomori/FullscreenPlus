// 1. On a webpage, forward the popup's existing volume messages to background.js.
// 2. In html/offscreen.html, capture, amplify, and play the tab's audio.
// This keeps the Web Audio boost implementation entirely in volume.js.

(() => {
    const isOffscreen =
        location.href === chrome.runtime.getURL('html/offscreen.html');

    if (!isOffscreen) {
        // Only the top-level content script should answer popup messages.
        // This avoids duplicate replies when the extension runs in all frames.
        if (window !== window.top) return;

        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.type !== 'get-volume-boost' &&
                request.type !== 'volume-boost-update') return false;

            // Preserve compatibility with existing popup chrome.tabs.sendMessage().
            chrome.runtime.sendMessage({
                target: 'background',
                type: request.type,
                volume: request.volume
            }).then(sendResponse).catch(error => {
                sendResponse({ success: false, error: error.message });
            });

            return true;
        });
        return;
    }

    // Everything below runs ONLY in the offscreen extension document.
    const captures = new Map(); // tabId -> { stream, audioCtx, source, gainNode, ... }

    function changeVolume(tabId, percentage) {
        const capture = captures.get(tabId);
        if (!capture) return { success: false, error: 'Tab is not being captured.' };

        // Smooth gain changes slightly to prevent clicks when dragging slider.
        capture.gainNode.gain.setTargetAtTime(
            percentage / 100,
            capture.audioCtx.currentTime,
            0.008
        );
        capture.volume = percentage;

        if (capture.audioCtx.state === 'suspended') {
            capture.audioCtx.resume().catch(error => {
                console.log('[WARN] Could not resume boosted audio:', error);
            });
        }

        return { success: true, volume: percentage };
    }


    async function stopCapture(tabId) {
        const capture = captures.get(tabId);
        if (!capture) return { success: true, volume: 100 };

        captures.delete(tabId);

        // Stopping these tracks returns audio output to the original tab.
        capture.stream.getTracks().forEach(track => track.stop());
        capture.source.disconnect();
        capture.highPassFilter.disconnect();
        capture.gainNode.disconnect();
        capture.compressor.disconnect();
        await capture.audioCtx.close().catch(() => {});

        return { success: true, volume: 100 };
    }


    async function startCapture(tabId, streamId, percentage) {
        if (captures.has(tabId)) return changeVolume(tabId, percentage);

        let stream;
        let audioCtx;

        try {
            // Receive the audio of the ENTIRE tab, independent of video URL/CORS.
            stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    mandatory: {
                        chromeMediaSource: 'tab',
                        chromeMediaSourceId: streamId
                    }
                },
                video: false
            });

            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioCtx.createMediaStreamSource(stream);

            // Preserve the user's original high-pass -> gain -> compressor chain.
            const highPassFilter = audioCtx.createBiquadFilter();
            highPassFilter.type = 'highpass';
            highPassFilter.frequency.value = 35;
            highPassFilter.Q.value = 0.7;

            const gainNode = audioCtx.createGain();
            gainNode.gain.value = percentage / 100;

            const compressor = audioCtx.createDynamicsCompressor();
            compressor.threshold.value = -1;
            compressor.knee.value = 6;
            compressor.ratio.value = 20;
            compressor.attack.value = 0.001;
            compressor.release.value = 0.15;

            source.connect(highPassFilter);
            highPassFilter.connect(gainNode);
            gainNode.connect(compressor);
            compressor.connect(audioCtx.destination);

            // Confirm that audio can actually play before reporting success.
            // If autoplay blocks resume(), stop capturing so normal tab audio returns.
            if (audioCtx.state === 'suspended') {
                let timer;
                try {
                    await Promise.race([
                        audioCtx.resume(),
                        new Promise((_, reject) => {
                            timer = setTimeout(() => reject(new Error(
                                'Chrome blocked boosted audio playback.'
                            )), 3000);
                        })
                    ]);
                } finally {
                    clearTimeout(timer);
                }
            }

            if (audioCtx.state !== 'running') {
                console.log('Captured audio is not playing.');
            }

            captures.set(tabId, {
                stream, audioCtx, source, highPassFilter,
                gainNode, compressor, volume: percentage
            });

            // If Chrome ends capture (for example, the tab is closed), clean up.
            for (const track of stream.getAudioTracks()) {
                track.addEventListener('ended', () => {
                    if (captures.get(tabId)?.stream === stream) {
                        stopCapture(tabId).catch(console.log);
                    }
                }, { once: true });
            }

            return { success: true, volume: percentage };
        } catch (error) {
            if (stream) stream.getTracks().forEach(track => track.stop());
            if (audioCtx) await audioCtx.close().catch(() => {});
            console.error('Tab audio capture failed:', error);
            return { success: false, error: error.message };
        }
    }


    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.target !== 'offscreen') return false;

        (async () => {
            switch (request.type) {
                case 'AUDIO_STATUS': {
                    const capture = captures.get(request.tabId);
                    return {
                        active: Boolean(capture),
                        volume: capture?.volume ?? 100
                    };
                }
                case 'AUDIO_START':
                    return startCapture(request.tabId, request.streamId, request.volume);
                case 'AUDIO_VOLUME':
                    return changeVolume(request.tabId, request.volume);
                case 'AUDIO_STOP':
                    return stopCapture(request.tabId);
                default:
                    return { success: false, error: 'Unknown audio operation.' };
            }
        })().then(sendResponse).catch(error => {
            sendResponse({ success: false, error: error.message });
        });

        return true;
    });
})();
