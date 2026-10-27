const fullscreenClass = 'windowed-mode-fullscreen';
const hostname = location.hostname.replace(/^www\./, '');
const validModes = new Set(['ask', 'in-window', 'native']);
let fullscreenWindowElement = null;
let fullscreenWindowFrame = null;
let fullscreenChoiceOverlay = null;
let fullscreenChoiceFrame = null;
let fullscreenChoiceRequestSource = null;
let fullscreenChoiceRequestOrigin = null;
let currentMode = 'ask';
let deferredMode = null; // Temporarily stores potential mode change to not interfere with active fullscreen


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
    'windowed-fullscreen-request': handleWindowedRequest,
    'windowed-fullscreen-exit': handleWindowedExit,
};

window.addEventListener('message', event => {
    const handler = messageHandlers[event.data?.type];
    if (handler) handler(event);
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
        }, event.origin || '*');
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


// SHADOW DOM MODAL CHOICE IMPLEMENTATION

function showFullscreenChoice(requestSource, requestOrigin) {
    if (fullscreenChoiceOverlay) {
        return;
    }
    fullscreenChoiceOverlay = document.createElement('div');
    fullscreenChoiceOverlay.className = 'fullscreen-choice-overlay';
    fullscreenChoiceRequestSource = requestSource;
    fullscreenChoiceRequestOrigin = requestOrigin;

    // Attach Shadow DOM for perfect CSS isolation
    const shadow = fullscreenChoiceOverlay.attachShadow({mode: 'open'});

    const style = document.createElement('style');
    style.textContent = `
        .backdrop {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(8, 8, 16, 0.72);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            animation: vfs-fade-in 0.18s ease-out;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            color: #e8e8f0;
        }
        @keyframes vfs-fade-in { from { opacity: 0; } to { opacity: 1; } }
        
        .dialog {
            width: 380px;
            max-width: calc(100vw - 32px);
            padding: 24px;
            border-radius: 16px;
            background: linear-gradient(160deg, #1c1c2a, #14141f);
            border: 1px solid rgba(255, 255, 255, 0.08);
            box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
            text-align: left;
            animation: vfs-pop-in 0.18s ease-out;
        }
        @keyframes vfs-pop-in { from { opacity: 0; transform: translateY(8px) scale(0.97); } to { opacity: 1; transform: none; } }
        
        h1 { margin: 0 0 8px; color: #fff; font: 650 20px/1.2 -apple-system, system-ui, sans-serif; }
        p { margin: 0 0 20px; color: #8080a0; font: 400 14px/1.5 -apple-system, system-ui, sans-serif; }
        .option-icon { font-size: 18px;  margin-right: 8px; vertical-align: middle; }
        
        .actions { display: flex; gap: 10px; flex-direction: column; }
        
        button {
            padding: 14px 18px;
            border: 1px solid rgba(53, 119, 255, 0.3);
            border-radius: 11px;
            color: #fff;
            background: rgba(53, 119, 255, 0.1);
            cursor: pointer;
            font: 600 14px/1.5 -apple-system, system-ui, sans-serif;
            transition: all 0.15s ease;
            text-align: left;
            width: 100%;
        }
        button:hover { background: rgba(53, 119, 255, 0.2); border-color: #3577ff; transform: translateY(-1px); }
        
        button.cancel { 
            padding: 10px 18px;
            background: transparent; 
            border: 1px solid rgba(255, 255, 255, 0.1); 
            color: #8080a0; 
            font-weight: 500; 
            margin-top: 8px; 
            text-align: center; 
        }
        button.cancel:hover { color: #ff8080; border-color: rgba(255, 100, 100, 0.25); transform: none; }
    `;

    const html = `
        <div class="backdrop">
            <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="choice-title">
                <h1 id="choice-title">Choose Fullscreen Mode</h1>
                <p>How should this video be displayed?</p>
                <div class="actions">
                    <button type="button" data-mode="in-window"><span class=option-icon>🗔</span> In-window fullscreen</button>
                    <button type="button" data-mode="native"><span class=option-icon>⛶</span> Native fullscreen</button>
                    <button type="button" class="cancel" data-mode="cancel">Cancel</button>
                </div>
            </div>
        </div>
    `;

    shadow.appendChild(style);

    const template = document.createElement('template');
    template.innerHTML = html;
    shadow.appendChild(template.content.cloneNode(true));

    // Event handling inside Shadow DOM
    shadow.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-mode]');
        if (button) {
            const mode = button.dataset.mode;
            if (mode === 'cancel') {
                dismissChoice();
            } else {
                selectChoice(mode);
            }
        }
    });

    // Close the fullscreen choice overlay if clicking outside the dialog
    const backdrop = shadow.querySelector('.backdrop');
    if (backdrop) {
        backdrop.addEventListener('click', (event) => {
            if (event.target === backdrop) {
                dismissChoice();
            }
        });
    }
    document.documentElement.appendChild(fullscreenChoiceOverlay);
}


function selectChoice(mode) {
    if (['in-window', 'native'].includes(mode)) {
        // Use '*' to guarantee delivery regardless of origin matching quirks between MAIN/ISOLATED worlds
        fullscreenChoiceRequestSource?.postMessage({ type: 'fullscreen-choice-response', mode }, '*');
    }
    removeFullscreenChoice();
}


function dismissChoice() {
    if (fullscreenChoiceRequestSource) {
        fullscreenChoiceRequestSource.postMessage({ type: 'fullscreen-choice-response', mode: null }, '*');
    }
    removeFullscreenChoice();
}


function removeFullscreenChoice() {
    fullscreenChoiceOverlay?.remove();
    fullscreenChoiceOverlay = null;
    fullscreenChoiceRequestSource = null;
    fullscreenChoiceRequestOrigin = null;
}


// FULLSCREEN MANAGEMENT

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
        detail: {windowedFullscreen: true}
    }));
    window.dispatchEvent(new Event('resize'));

    if (fullscreenWindowFrame && window.parent !== window) {
        window.parent.postMessage({type: 'windowed-fullscreen-request'}, '*');
    }
}


function fullscreenExit() {
    if (fullscreenWindowElement === null) {
        return;
    }
    fullscreenWindowElement.classList.remove(fullscreenClass);
    fullscreenWindowElement = null;

    document.dispatchEvent(new CustomEvent('fullscreenchange', {
        detail: {windowedFullscreen: true}
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