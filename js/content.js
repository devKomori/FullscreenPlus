const fullscreenClass = 'windowed-mode-fullscreen';
let fullscreenWindowElement = null;


window.addEventListener('message', (event) => {
    if (event.data?.type !== 'windowed-fullscreen-exit') {
        if (event.source !== window) {
            return;
        }
        if (event.data?.type === 'windowed-fullscreen-request') {
            const requestedElement = document.querySelector('[windowed-fullscreen-data-request]');

            if (requestedElement !== null) {
                requestedElement.removeAttribute('windowed-fullscreen-data-request');
                enterWindowedFullscreen(requestedElement);
            }
        }
        return;
    }
    if (event.source === window || event.source?.top === window) {
        fullscreenExit();
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