// Background service worker: requests tab capture and manages the offscreen document.
// The actual Web Audio processing is in js/volume.js.

const OFFSCREEN_PATH = 'html/offscreen.html';
let creatingOffscreen = null;
const tabQueues = new Map();


async function offscreenExists() {
    const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
    });
    return contexts.length > 0;
}


async function ensureOffscreen() {
    if (creatingOffscreen) {
        await creatingOffscreen;
        return;
    }

    if (await offscreenExists()) return;

    if (!creatingOffscreen) {
        creatingOffscreen = chrome.offscreen.createDocument({
            url: OFFSCREEN_PATH,
            reasons: ['USER_MEDIA'],
            justification: 'Process captured tab audio for user-controlled volume boosting.'
        });
    }

    try {
        await creatingOffscreen;
    } finally {
        creatingOffscreen = null;
    }
}


function messageOffscreen(type, data = {}) {
    return chrome.runtime.sendMessage({
        target: 'offscreen',
        type,
        ...data
    });
}


// Serialize each tab's changes so rapid slider input cannot start two captures.
function queueForTab(tabId, work) {
    const previous = tabQueues.get(tabId) || Promise.resolve();
    const current = previous.catch(() => {
    }).then(work);
    tabQueues.set(tabId, current);

    current.finally(() => {
        if (tabQueues.get(tabId) === current) tabQueues.delete(tabId);
    }).catch(() => {
    });

    return current;
}


async function resolveTabId(sender, request) {
    // Messages forwarded by volume.js know exactly which tab sent them.
    if (sender.tab?.id !== undefined) return sender.tab.id;

    // Also support popup code using chrome.runtime.sendMessage directly.
    if (Number.isInteger(request.tabId)) return request.tabId;

    const tabs = await chrome.tabs.query({active: true, lastFocusedWindow: true});
    if (tabs[0]?.id === undefined) {
        throw new Error('No active tab available for audio boosting.');
    }
    return tabs[0].id;
}


async function getTabVolume(tabId) {
    // Wait for in-progress slider changes to finish before reporting state.
    const pending = tabQueues.get(tabId);
    if (pending) await pending.catch(() => {
    });

    if (!await offscreenExists()) return {volume: 100};

    const result = await messageOffscreen('AUDIO_STATUS', {tabId});
    return {volume: result?.volume ?? 100};
}


async function setTabVolume(tabId, volume) {
    if (!Number.isFinite(volume) || volume < 0) {
        throw new Error('Invalid volume percentage.');
    }

    // At 100%, stop capture: Chrome restores the tab's normal audio path.
    if (volume === 100) {
        if (await offscreenExists()) {
            const result = await messageOffscreen('AUDIO_STOP', {tabId});
            if (!result?.success) {
                throw new Error(result?.error || 'Unable to stop tab audio capture.');
            }
        }
        return {success: true, volume: 100};
    }

    await ensureOffscreen();

    const status = await messageOffscreen('AUDIO_STATUS', {tabId});
    if (status?.active) {
        const result = await messageOffscreen('AUDIO_VOLUME', {tabId, volume});
        if (!result?.success) {
            throw new Error(result?.error || 'Unable to change tab volume.');
        }
        return result;
    }

    // Must be requested following the user's extension/popup interaction.
    // Chrome 116+ can pass this ID from the service worker to an offscreen page.
    const streamId = await chrome.tabCapture.getMediaStreamId({targetTabId: tabId});
    const result = await messageOffscreen('AUDIO_START', {tabId, streamId, volume});

    if (!result?.success) {
        throw new Error(result?.error || 'Unable to start tab audio capture.');
    }
    return result;
}


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Other extension features and messages meant for volume.js are ignored.
    if (request.target === 'offscreen') return false;

    if (request.type !== 'get-volume-boost' &&
        request.type !== 'volume-boost-update') return false;

    (async () => {
        const tabId = await resolveTabId(sender, request);

        if (request.type === 'get-volume-boost') {
            return getTabVolume(tabId);
        }

        const volume = Number(request.volume);
        return queueForTab(tabId, () => setTabVolume(tabId, volume));
    })().then(sendResponse).catch(error => {
        console.error('FullscreenPlus audio error:', error);
        sendResponse({success: false, error: error.message});
    });

    // Keep the message channel open for the asynchronous response.
    return true;
});

// Clean up capture if a tab is closed (the stream usually ends automatically).
chrome.tabs.onRemoved.addListener(tabId => {
    queueForTab(tabId, async () => {
        if (await offscreenExists()) {
            await messageOffscreen('AUDIO_STOP', {tabId});
        }
    }).catch(() => {
    });
});
