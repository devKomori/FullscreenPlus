const fullscreenClass = 'windowed-mode-fullscreen';
let fullscreenWindowElement = null;


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
    fullscreenWindowElement = element;
    fullscreenWindowElement.classList.add(fullscreenClass);

    document.dispatchEvent(new Event('fullscreenchange'));
    window.dispatchEvent(new Event('resize'));
}



function fullscreenExit() {
    if (fullscreenWindowElement === null) {
        return;
    }
    fullscreenWindowElement.classList.remove(fullscreenClass);
    document.dispatchEvent(new Event('fullscreenchange'));
    window.dispatchEvent(new Event('resize'));
    fullscreenWindowElement = null;
}