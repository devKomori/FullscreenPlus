// Firefox MV3 background event page.
// Manages per-tab volume state; audio processing stays in the content script.
// Uses browser.* because Firefox supports promise-based extension APIs.

const VOLUME_KEY_PREFIX = 'fullscreenplus-volume-';

function keyForTab(tabId) {
    return `${VOLUME_KEY_PREFIX}${tabId}`;
}


async function getTabVolume(tabId) {
    const key = keyForTab(tabId);
    const saved = await browser.storage.session.get(key);
    return saved[key] ?? 100;
}


function resolveTabId(request, sender) {
    return Number.isInteger(request.tabId) && request.tabId >= 0
        ? request.tabId
        : sender.tab?.id;
}


browser.runtime.onMessage.addListener((request, sender) => {
    if (!request || typeof request.type !== 'string') return undefined;

    if (request.type === 'get-volume-boost' ||
        request.type === 'firefox-volume-get-for-frame') {
        return (async () => {
            const tabId = resolveTabId(request, sender);
            if (!Number.isInteger(tabId)) {
                return { volume: 100, success: false, error: 'No target tab.' };
            }
            return { volume: await getTabVolume(tabId), success: true };
        })();
    }

    if (request.type === 'volume-boost-update') {
        return (async () => {
            const tabId = resolveTabId(request, sender);
            const volume = Number(request.volume);

            if (!Number.isInteger(tabId)) {
                return { success: false, error: 'No target tab.' };
            }
            if (!Number.isFinite(volume) || volume < 0 || volume > 1000) {
                return { success: false, error: 'Invalid volume percentage.' };
            }

            await browser.storage.session.set({ [keyForTab(tabId)]: volume });

            try {
                // No frameId = broadcast to every accessible content-script frame.
                await browser.tabs.sendMessage(tabId, {
                    type: 'firefox-volume-apply',
                    volume
                });
                return { success: true };
            } catch (error) {
                // Keep the setting for when a supported page/frame loads.
                return {
                    success: false,
                    error: `Cannot reach a media content script: ${error.message}`
                };
            }
        })();
    }

    return undefined;
});

browser.tabs.onRemoved.addListener(tabId => {
    browser.storage.session.remove(keyForTab(tabId)).catch(console.warn);
});
