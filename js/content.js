const fullscreenClass = 'windowed-mode-fullscreen';
const hostname = location.hostname.replace(/^www\./, '');
const validModes = new Set(['ask', 'in-window', 'native-fullscreen']);
let fullscreenWindowElement = null;
let fullscreenWindowFrame = null;
let fullscreenChoiceOverlay = null;
let fullscreenChoiceFrame = null;
let fullscreenChoiceRequestSource = null;
let fullscreenChoiceRequestOrigin = null;
let currentMode = 'ask';
let deferredMode = null; // Temporarily stores mode change made while fullscreen is active to prevent disruption. Applied after exiting fullscreen.



// MODE MANAGEMENT

function sendModeToPage(mode) {
    const safeMode = validModes.has(mode) ? mode : 'ask';
    window.postMessage({
        type: 'fullscreen-mode-update',
        mode: safeMode
    }, '*');
}


async function loadMode() {
    if (window.top !== window) {
        return;
    }
    const result = await chrome.storage.local.get('fullscreenPreferences');
    const preferences = result.fullscreenPreferences || {};
    const savedMode = preferences[hostname] || 'ask';
    currentMode = validModes.has(savedMode) ? savedMode : 'ask';
    sendModeToPage(currentMode);
}


chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'fullscreen-mode-update') {
        return;
    }
    const mode = validModes.has(message.mode) ? message.mode : 'ask';
    currentMode = mode;
    if (mode !== 'ask') {
        removeFullscreenChoice();
    }

    if (isFullscreenActive()) {
        deferredMode = mode;
        return;
    }
    sendModeToPage(mode);
});

loadMode();


// MESSAGE HANDLING

const messageHandlers = {
    'fullscreen-mode-update': handleModeUpdate,
    'fullscreen-mode-query': handleModeQuery,
    'fullscreen-choice-request': handleChoiceRequest,
    'fullscreen-choice-selected': handleChoiceSelected,
    'fullscreen-choice-dismiss': handleChoiceDismiss,
    'windowed-fullscreen-request': handleWindowedRequest,
    'windowed-fullscreen-exit': handleWindowedExit,
};

window.addEventListener('message', (event) => {
    const type = event.data?.type;
    if (!type || !messageHandlers[type]) return;

    messageHandlers[type](event);
});


function handleModeUpdate(event) {
    const mode = validModes.has(event.data.mode) ? event.data.mode : 'ask';
    if (mode === 'ask' && deferredMode !== null) {
        currentMode = deferredMode;
        deferredMode = null;
        sendModeToPage(currentMode);
        return;
    }
    currentMode = mode;
    if (event.source !== window) {
        sendModeToPage(currentMode);
    }
    if (mode === 'ask') {
        removeFullscreenChoice();
    }
}


function handleModeQuery(event) {
    if (event.source !== window) {
        event.source.postMessage({
            type: 'fullscreen-mode-update',
            mode: currentMode
        }, event.origin);
    }
}


function handleChoiceRequest(event) {
    if (currentMode !== 'ask') {
        return;
    }
    if (event.source === window && window.parent !== window) {
        window.parent.postMessage(event.data, '*');
        return;
    }
    showFullscreenChoice(event.source, event.origin);
}


function handleChoiceSelected(event) {
    if (!fullscreenChoiceFrame ||
        event.source !== fullscreenChoiceFrame.contentWindow ||
        !validModes.has(event.data.mode)) {
        return;
    }
    fullscreenChoiceRequestSource?.postMessage({
        type: 'fullscreen-choice-response',
        mode: event.data.mode
    }, fullscreenChoiceRequestOrigin || window.location.origin);
    removeFullscreenChoice();
}


function handleChoiceDismiss(event) {
    if (fullscreenChoiceFrame && event.source === fullscreenChoiceFrame.contentWindow) {
        removeFullscreenChoice();
    }
}


function handleWindowedRequest(event) {
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


function handleWindowedExit(event) {
    if (event.source === window || window.parent === window) {
        fullscreenExit();
        applyModeAfterExit(event.source, event.origin);
    }
}


// FULLSCREEN MANAGEMENT

function showFullscreenChoice(requestSource, requestOrigin) {
    if (fullscreenChoiceOverlay) {
        return;
    }
    fullscreenChoiceOverlay = document.createElement('div');
    fullscreenChoiceOverlay.className = 'fullscreen-choice-overlay';
    fullscreenChoiceRequestSource = requestSource;
    fullscreenChoiceRequestOrigin = requestOrigin;
    fullscreenChoiceFrame = document.createElement('iframe');
    fullscreenChoiceFrame.title = 'Fullscreen display options';
    fullscreenChoiceFrame.src = chrome.runtime.getURL('html/choice.html');
    fullscreenChoiceOverlay.appendChild(fullscreenChoiceFrame);
    fullscreenChoiceFrame.addEventListener('load', () => {
        fullscreenChoiceFrame?.contentWindow?.postMessage({
            type: 'fullscreen-choice-context',
            requestOrigin
        }, '*');
    }, {once: true});

    document.documentElement.appendChild(fullscreenChoiceOverlay);
}


function removeFullscreenChoice() {
    fullscreenChoiceOverlay?.remove();
    fullscreenChoiceOverlay = null;
    fullscreenChoiceFrame = null;
    fullscreenChoiceRequestSource = null;
    fullscreenChoiceRequestOrigin = null;
}


function applyModeAfterExit(requestSource, requestOrigin) {
    if (deferredMode !== null) {
        currentMode = deferredMode;
        deferredMode = null;
    }
    sendModeToPage(currentMode);

    if (requestSource !== window) {
        requestSource?.postMessage({
            type: 'fullscreen-mode-update',
            mode: currentMode
        }, requestOrigin || window.location.origin);
    }
}


function isFullscreenActive() {
    return fullscreenWindowElement !== null || document.fullscreenElement !== null;
}


function enterWindowedFullscreen(element) {
    if (fullscreenWindowElement !== element) {
        fullscreenWindowElement?.classList.remove(fullscreenClass);
    }
    fullscreenWindowElement = element;
    fullscreenWindowFrame = element.tagName === 'IFRAME' ? element : null;
    fullscreenWindowElement.classList.add(fullscreenClass);
    fullscreenWindowElement.removeAttribute('windowed-fullscreen-data-request');

    // CustomEvent to safely attach the windowedFullscreen detail
    document.dispatchEvent(new CustomEvent('fullscreenchange', {
        detail: { windowedFullscreen: true }
    }));
    window.dispatchEvent(new Event('resize'));

    if (fullscreenWindowFrame && window.parent !== window) {
        window.parent.postMessage({ type: 'windowed-fullscreen-request' }, '*');
    }
}


function fullscreenExit() {
    if (fullscreenWindowElement === null) {
        return;
    }
    fullscreenWindowElement.classList.remove(fullscreenClass);
    fullscreenWindowElement = null;

    
    document.dispatchEvent(new CustomEvent('fullscreenchange', {
        detail: { windowedFullscreen: true }
    }));
    window.dispatchEvent(new Event('resize'));
}


// Handle Escape key to exit fullscreen
document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
        return;
    }
    if (fullscreenWindowElement !== null) {
        event.preventDefault();
        event.stopImmediatePropagation();
        fullscreenExit();
        return;
    }
    if (window.top !== window) {
        window.top.postMessage({
            type: 'windowed-fullscreen-exit'
        }, '*');
    }
}, true);