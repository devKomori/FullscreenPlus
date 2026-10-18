
(() => {
    const requestMsg = 'windowed-fullscreen-request';
    const exitMsg = 'windowed-fullscreen-exit';
    const requestMarker = 'windowed-fullscreen-data-request';
    const validModes = new Set(['ask', 'in-window', 'native-fullscreen']);
    let currentFullscreenElement = null;
    let fullscreenMode = 'ask';
    let pendingFullscreenRequest = null;
    let waitingForAuthoritativeMode = false;
    let lastNativeFullscreenElement = null;
    
    const nativeFullscreenElementGetter =
    Object.getOwnPropertyDescriptor(Document.prototype, 'fullscreenElement')?.get;
    
    if (!nativeFullscreenElementGetter) {
        console.error('[FullscreenPlus] fullscreenElement is unavailable.');
        return;
    }

    const requestFullscreenNames = [
        'requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen',
        'mozRequestFullScreen', 'msRequestFullscreen'];

    const exitFullscreenNames = [
        'exitFullscreen', 'webkitExitFullscreen', 'webkitCancelFullScreen',
        'mozCancelFullScreen', 'msExitFullscreen'];



    function getNativeFullscreenElement() {
        return nativeFullscreenElementGetter.call(document);
    }

    function postMessageToContent(message) {
        window.postMessage(message, '*');
    }

    function normalizeMode(mode) {
        return validModes.has(mode) ? mode : 'ask';
    }


    // MESSAGE HANDLING 

    const messageHandlers = {
        'fullscreen-mode-update': handleModeUpdate,
        'fullscreen-choice-response': handleChoiceResponse
    };

    window.addEventListener('message', (event) => {
        const type = event.data?.type;
        if (!type || !messageHandlers[type]) return;

        messageHandlers[type](event);
    });


    function handleModeUpdate(event) {
        const message = event.data;
        const isParentUpdate = window.top !== window && event.source === window.parent;

        if (event.source !== window && !isParentUpdate){
            return;
        }
        fullscreenMode = normalizeMode(message.mode);
        waitingForAuthoritativeMode = false;

        if (pendingFullscreenRequest && isParentUpdate) {
            const request = pendingFullscreenRequest;
            pendingFullscreenRequest = null;

            if (fullscreenMode === 'ask') {
                pendingFullscreenRequest = request;
                postMessageToContent({ type: 'fullscreen-choice-request' });
            } 
            else if (fullscreenMode === 'in-window') {
                currentFullscreenElement = request.element;
                request.element.setAttribute(requestMarker, '');
                postMessageToContent({ type: requestMsg });
            } 
            else {
                const result = request.nativeRequest();
                if (typeof result?.catch === 'function') {
                    result.catch((error) => {
                        console.error('[FullscreenPlus] Native fullscreen failed:', error);
                    });
                }
            }
        }
    }


    function handleChoiceResponse(event) {
        if (event.source === window) {
            handleFullscreenChoice(event.data.mode);
        }
    }

    
    // FULLSCREEN INTERCEPTION

    function handleFullscreenChoice(mode) {
        if (!pendingFullscreenRequest || !['in-window', 'native-fullscreen'].includes(mode)) {
            return;
        }
        const request = pendingFullscreenRequest;
        pendingFullscreenRequest = null;

        if (mode === 'in-window') {
            currentFullscreenElement = request.element;
            request.element.setAttribute(requestMarker, '');
            fullscreenMode = 'ask';
            postMessageToContent({type: requestMsg});
            return;
        }
        // The native request is only executed after the user explicitly selects native fullscreen.
        const result = request.nativeRequest();
        fullscreenMode = 'ask';

        if (typeof result?.catch === 'function') {
            result.catch((error) => {
                console.error('[FullscreenPlus] Native fullscreen failed:', error);
            });
        }
    }


    // Expose the simulated fullscreen element for the page to use
    try {
        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get() {
                return currentFullscreenElement || getNativeFullscreenElement();
            }
        });
    } catch (error) {
        console.error('[FullscreenPlus] Could not override fullscreenElement:', error);
    }


    // Intercept fullscreen requests.
    requestFullscreenNames.forEach((name) => {
        const nativeRequestFullscreen = Element.prototype[name];

        if (typeof nativeRequestFullscreen !== 'function') {
            return;
        }
        Element.prototype[name] = function (...args) {
            if (window.top !== window && !waitingForAuthoritativeMode) {
                pendingFullscreenRequest = {
                    element: this,
                    nativeRequest: () => nativeRequestFullscreen.apply(this, args)
                };
                waitingForAuthoritativeMode = true;
                window.top.postMessage({ type: 'fullscreen-mode-query' }, '*');
                return Promise.resolve();
            }
            if (fullscreenMode === 'ask') {
                // Store the request and wait for the user's choice.
                pendingFullscreenRequest = {
                    element: this,
                    nativeRequest: () => nativeRequestFullscreen.apply(this, args)
                };
                postMessageToContent({ type: 'fullscreen-choice-request' });
                return Promise.resolve();
            }

            if (fullscreenMode === 'in-window') {
                currentFullscreenElement = this;
                this.setAttribute(requestMarker, '');
                postMessageToContent({ type: requestMsg });
                return Promise.resolve();
            }
            return nativeRequestFullscreen.apply(this, args);
        };
    });


    // Intercept fullscreen exit requests.
    exitFullscreenNames.forEach((name) => {
        const nativeExitFullscreen = Document.prototype[name];

        if (typeof nativeExitFullscreen !== 'function') {
            return;
        }
        Document.prototype[name] = function (...args) {
            if (currentFullscreenElement) {
                exitFullscreen();
                return Promise.resolve();
            }
            return nativeExitFullscreen.apply(this, args);
        };
    });


    function exitFullscreen() {
        if (!currentFullscreenElement) {
            return;
        }
        currentFullscreenElement = null;
        postMessageToContent({ type: exitMsg });
    }


    // Ignore the synthetic events generated by content.js.
    // Only a real native fullscreen exit should reset the mode.
    document.addEventListener('fullscreenchange', (event) => {
        if (event.detail?.windowedFullscreen === true) {
            return;
        }
        const nativeElement = getNativeFullscreenElement();
        const previousNativeElement = lastNativeFullscreenElement;
        lastNativeFullscreenElement = nativeElement;

        if (currentFullscreenElement || nativeElement || !previousNativeElement) {
            return;
        }
        pendingFullscreenRequest = null;
    });


    // Only intercept Escape when exiting our windowed mode.
    // Let the browser handle Escape during native fullscreen.
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !currentFullscreenElement) {
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();

        if (window.top !== window) {
            window.top.postMessage({
                type: exitMsg
            }, '*');

            return;
        }

        exitFullscreen();
    }, true);
})();
