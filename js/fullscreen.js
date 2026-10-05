(() => {
    const requestMsg = 'windowed-fullscreen-request';
    const exitMsg = 'windowed-fullscreen-exit';
    // Marker for elements that request fullscreen so the content script can identify and handle them
    const requestMarker = 'windowed-fullscreen-data-request';
    let currentFullscreenElement = null;



    // Overrides the value of document.fullscreenElement to return the currentFullscreenElement, if any.
    try {
        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => currentFullscreenElement
        });
    } catch (error) {
        console.error('Error while overriding fullscreenElement:', error);
    }



    // Overrides default behavior of requestFullscreen method.
    Element.prototype.requestFullscreen = function () {
        currentFullscreenElement = this;
        this.setAttribute(requestMarker, '');
        window.postMessage({type: requestMsg}, window.location.origin);
        return Promise.resolve();
    };



    // Overrides default behavior of exitFullscreen method.
    Document.prototype.exitFullscreen = function () {
        exitFullscreen();
        return Promise.resolve();
    }

    function exitFullscreen() {
        currentFullscreenElement = null;
        window.postMessage({type: exitMsg}, window.location.origin);
    }



    // Listens for Escape key press and directly calls exitFullscreen if the current window is the topmost window,
    // or sends a message to the top window to exit fullscreen mode if the current window is not the topmost window.
    document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') {
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();

            if (window.top !== window) {
                window.top.postMessage({ type: 'windowed-fullscreen-exit' }, '*');
                return;
            }
            exitFullscreen();
        }, true
    );


})();