(() => {
    const requestMsg = 'windowed-fullscreen-request';
    const exitMsg = 'windowed-fullscreen-exit';
    // Marker for elements that request fullscreen so the content script can identify and handle them
    const requestMarker = 'windowed-fullscreen-data-request';


    const setFullscreenElementProperty = (element) => {
        try {
            Object.defineProperty(document, 'fullscreenElement', {
                configurable: true,
                get: () => element
            });
        } catch (error) {
            console.error('Error while setting fullscreen property:', error);
        }
    };


    setFullscreenElementProperty(null);

    Element.prototype.requestFullscreen = function () {
        setFullscreenElementProperty(this);
        this.setAttribute(requestMarker, '');
        window.postMessage({type: requestMsg}, '*');
        return Promise.resolve();
    }

    Document.prototype.exitFullscreen = function () {
        setFullscreenElementProperty(null);
        window.postMessage({type: exitMsg}, '*');
        return Promise.resolve();
    }


    // Exit simulated fullscreen when Escape is pressed.
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();

        if (window.top !== window) {
            window.top.postMessage({type: exitMsg}, '*');
            return;
        }
        document.exitFullscreen();

    }, true);


    window.addEventListener('message', (event) => {
        if (event.data?.type === 'windowed-fullscreen-clear') {
            setFullscreenElementProperty(null);
        }
    });


})();