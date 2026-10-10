const fullscreenClass = 'windowed-mode-fullscreen';
let fullscreenWindowElement = null;
let fullscreenWindowFrame = null;


const getMarkedElement = (root = document) => {
    return root.querySelector(`[windowed-fullscreen-data-request]`);
};


const getIframeElementForWindow = (source, root = document) => {
    for (const iframe of root.querySelectorAll('iframe')) {
        if (iframe.contentWindow === source) {
            return iframe;
        }
    }
    return null;
};


function enterWindowedFullscreen(element, isFrame = false) {
    // Exit fullscreen for the previous element if it exists and is different from the new one.
    if (fullscreenWindowElement && fullscreenWindowElement !== element) {
        fullscreenWindowElement.classList.remove(fullscreenClass);
    }

    fullscreenWindowElement = element;
    fullscreenWindowFrame = isFrame ? element : null;

    element.classList.add(fullscreenClass);
    element.removeAttribute('windowed-fullscreen-data-request');

    document.dispatchEvent(new Event('fullscreenchange'));
    window.dispatchEvent(new Event('resize'));

    if (isFrame && window.parent !== window) {
        window.parent.postMessage({type: 'windowed-fullscreen-request'}, '*');
    }
}


function fullscreenExit() {
    window.postMessage({type: 'windowed-fullscreen-clear'}, '*');

    if (!fullscreenWindowElement) {
        return;
    }
    const frame = fullscreenWindowFrame;
    fullscreenWindowElement.classList.remove(fullscreenClass);
    fullscreenWindowElement = null;
    fullscreenWindowFrame = null;

    if (frame?.contentWindow) {
        frame.contentWindow.postMessage({type: 'windowed-fullscreen-exit'}, '*');
    }
    document.dispatchEvent(new Event('fullscreenchange'));
    window.dispatchEvent(new Event('resize'));
}


window.addEventListener('message', (event) => {
    if (event.data?.type === 'windowed-fullscreen-request') {
        if (event.source === window && window.parent !== window) {
            window.parent.postMessage(event.data, '*');
            return;
        }
        if (event.source === window) {
            const requestedElement = getMarkedElement();
            if (requestedElement) {
                enterWindowedFullscreen(requestedElement);
            }
        } else {
            const iframe = getIframeElementForWindow(event.source);
            if (iframe) {
                enterWindowedFullscreen(iframe, true);
            }
        }
        return;
    }

    if (event.data?.type === 'windowed-fullscreen-exit') {
        // The top-level page handles all exit requests.
        if (window.parent === window) {
            fullscreenExit();
            return;
        }
        // A child frame forwards its own exit request to the parent.
        if (event.source === window) {
            window.parent.postMessage(event.data, '*');
            return;
        }
        // A parent frame is telling this child frame to exit.
        if (event.source === window.parent) {
            fullscreenExit();
        }
    }

});
