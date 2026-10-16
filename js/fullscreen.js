(() => {
    const requestMsg = 'windowed-fullscreen-request';
    const exitMsg = 'windowed-fullscreen-exit';
    const requestMarker = 'windowed-fullscreen-data-request'; // Mark the element requesting fullscreen
    let currentFullscreenElement = null;
    let fullscreenMode = 'ask'; // 'ask mode' is the default until preferences are loaded
    const nativeFullscreenElementGetter = Object.getOwnPropertyDescriptor(Document.prototype, 'fullscreenElement').get;
    const requestFullscreenNames = [
        'requestFullscreen',
        'webkitRequestFullscreen',
        'webkitRequestFullScreen',
        'mozRequestFullScreen',
        'msRequestFullscreen'
    ];
    const exitFullscreenNames = [
        'exitFullscreen',
        'webkitExitFullscreen',
        'webkitCancelFullScreen',
        'mozCancelFullScreen',
        'msExitFullscreen'
    ];


    window.addEventListener('message', (event) => {
        if (event.data?.type === 'fullscreen-mode-update') {
            fullscreenMode = event.data.mode;
            currentFullscreenElement = null;
        }
    });


// Override the fullscreenElement property to return the currentFullscreenElement if it exists
    try {
        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => {
                if (currentFullscreenElement) {
                    return currentFullscreenElement;
                }
                return nativeFullscreenElementGetter.call(document);
            }
        });
    } catch (error) {
        console.error('Error while overriding fullscreenElement:', error);
    }


// Override the requestFullscreen method to handle fullscreen requests based on the current fullscreen mode
    requestFullscreenNames.forEach((name) => {
        const nativeRequestFullscreen = Element.prototype[name];
        if (typeof nativeRequestFullscreen !== 'function') {
            return;
        }
        Element.prototype[name] = function (...args) {
            if (fullscreenMode !== 'in-window') {
                return nativeRequestFullscreen.apply(this, args);
            }
            currentFullscreenElement = this;
            this.setAttribute(requestMarker, '');

            window.postMessage({type: requestMsg}, window.location.origin);
            return Promise.resolve();
        }
    })


// Override the exitFullscreen method to handle exiting fullscreen mode based on the current fullscreen mode
    exitFullscreenNames.forEach((name) => {
        const nativeExitFullscreen = Document.prototype[name];
        if (typeof nativeExitFullscreen !== 'function') {
            return;
        }
        Document.prototype[name] = function () {
            if (fullscreenMode !== 'in-window') {
                return nativeExitFullscreen.apply(this);
            }
            exitFullscreen();
            return Promise.resolve();
        }
    })

    function exitFullscreen() {
        currentFullscreenElement = null;
        window.postMessage({type: exitMsg}, window.location.origin);
    }


// Listen for the Escape key to exit fullscreen mode
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
            exitFullscreen();
        }, true
    );

})();