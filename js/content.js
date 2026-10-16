const fullscreenClass = 'windowed-mode-fullscreen';
let fullscreenWindowElement = null;
let fullscreenWindowFrame = null;
const hostname = location.hostname.replace(/^www\./, '');
const validModes = new Set([
    'ask',
    'in-window',
    'native-fullscreen'
]);


function sendModeToPage(mode) {
    const safeMode = validModes.has(mode) ? mode : 'ask';
    window.postMessage({
            type: 'fullscreen-mode-update',
            mode: safeMode
        },
        window.location.origin);
}


async function loadMode() {
    const result = await chrome.storage.local.get('fullscreenPreferences');
    const preferences = result.fullscreenPreferences || {};
    const savedMode = preferences[hostname] || 'ask';

    sendModeToPage(validModes.has(savedMode) ? savedMode : 'ask');
}


chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'fullscreen-mode-update') {
        return;
    }
    const mode = validModes.has(message.mode) ? message.mode : 'ask';

    if (mode !== 'in-window') {
        fullscreenExit(false);
    }
    sendModeToPage(mode);
});

loadMode();


window.addEventListener('message', (event) => {
    if (event.data?.type === 'windowed-fullscreen-request') {
        if (event.source === window && window.parent !== window) {
            window.parent.postMessage(event.data, '*');
            return;
        }
        // If the message is not from the current window, find the iframe that sent the fullscreen request
        if (event.source !== window) {
            const iframe = [...document.querySelectorAll('iframe')]
                .find((element) => element.contentWindow === event.source);

            if (iframe) {
                enterWindowedFullscreen(iframe);
            }
            return;
        }
        const requestedElement = document.querySelector('[windowed-fullscreen-data-request]');
        if (requestedElement) {
            requestedElement.removeAttribute('windowed-fullscreen-data-request');
            enterWindowedFullscreen(requestedElement);
        }
    }
    if (event.data?.type === 'windowed-fullscreen-exit') {
        if (event.source === window || window.parent === window) {
            fullscreenExit();
        }
    }
});


function enterWindowedFullscreen(element) {
    if (fullscreenWindowElement && fullscreenWindowElement !== element) {
        fullscreenWindowElement.classList.remove(fullscreenClass);
    }
    fullscreenWindowElement = element;
    fullscreenWindowFrame = element.tagName === 'IFRAME' ? element : null;
    fullscreenWindowElement.classList.add(fullscreenClass);
    fullscreenWindowElement.removeAttribute('windowed-fullscreen-data-request');

    document.dispatchEvent(new Event('fullscreenchange'));
    window.dispatchEvent(new Event('resize'));

    if (fullscreenWindowFrame && window.parent !== window) {
        window.parent.postMessage({type: 'windowed-fullscreen-request'}, '*');
    }
}


// notifyPage: if true, dispatch changes to the page; if false, just exit fullscreen without notifying the page
function fullscreenExit(notifyPage = true) {
    if (fullscreenWindowElement === null) {
        return;
    }
    fullscreenWindowElement.classList.remove(fullscreenClass);
    fullscreenWindowElement = null;

    if (!notifyPage) {
        return;
    }
    document.dispatchEvent(new Event('fullscreenchange'));
    window.dispatchEvent(new Event('resize'));
}