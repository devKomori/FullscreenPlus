// PAGE (MAIN world): intercept the website's Fullscreen API calls.
(() => {
    if (window.__vfpFullscreenHookInstalled) return;
    Object.defineProperty(window, '__vfpFullscreenHookInstalled', {value: true});

    const CHANNEL = 'vfp-compat-v2';
    const MARKER = 'data-vfp-request-id';
    const MODES = new Set(['ask', 'in-window', 'native']);
    const requests = [
        'requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen',
        'mozRequestFullScreen', 'msRequestFullscreen'
    ];
    const exits = [
        'exitFullscreen', 'webkitExitFullscreen', 'webkitCancelFullScreen',
        'mozCancelFullScreen', 'msExitFullscreen'
    ];
    const fullscreenProperties = [
        'fullscreenElement', 'webkitFullscreenElement', 'mozFullScreenElement',
        'mozFullscreenElement', 'msFullscreenElement'
    ];

    const nativeGetters = new Map();
    for (const name of fullscreenProperties) {
        let proto = document;
        while (proto && !Object.getOwnPropertyDescriptor(proto, name)) {
            proto = Object.getPrototypeOf(proto);
        }
        const getter = proto && Object.getOwnPropertyDescriptor(proto, name)?.get;
        if (getter) nativeGetters.set(name, getter);
    }

    let mode = 'ask';
    let modeIsReady = false;
    let pending = null;
    let currentElement = null;
    let currentId = null;
    let requestCounter = 0;

    const emit = (type, extra = {}) =>
        window.postMessage({channel: CHANNEL, type, ...extra}, '*');
    const abortError = (reason) => new DOMException(reason, 'AbortError');

    function findMarkedElement(root, id) {
        if (!root) return null;
        const all = root.querySelectorAll?.('*') || [];
        for (const candidate of all) {
            if (candidate.getAttribute(MARKER) === id) return candidate;
            if (candidate.shadowRoot) {
                const inside = findMarkedElement(candidate.shadowRoot, id);
                if (inside) return inside;
            }
        }
        return null;
    }

    for (const name of fullscreenProperties) {
        if (!nativeGetters.has(name)) continue;
        try {
            Object.defineProperty(document, name, {
                configurable: true,
                get() {
                    return currentElement || nativeGetters.get(name).call(document);
                }
            });
        } catch (e) {
            console.debug('[VideoFullscreen Pro] Cannot override', name, e);
        }
    }

    // Native events are fired on the fullscreen target and bubble to document;
    // dispatch there so listeners attached to the PLAYER also run.
    function dispatchFullscreenEvents(target = currentElement) {
        const dispatchTarget = target?.isConnected ? target : document;
        for (const name of [
            'fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange'
        ]) {
            dispatchTarget.dispatchEvent(new CustomEvent(name, {
                bubbles: true, composed: true,
                detail: {windowedFullscreen: true}
            }));
        }
        window.dispatchEvent(new Event('resize'));
    }

    for (const name of ['fullscreen', 'webkitIsFullScreen', 'mozFullScreen']) {
        const original = document[name];
        try {
            Object.defineProperty(document, name, {
                configurable: true,
                get() {
                    return Boolean(currentElement) || Boolean(original);
                }
            });
        } catch (_) { /* Deprecated property not writable on this browser. */
        }
    }

    function clearPending(error) {
        if (!pending) return;
        const old = pending;
        pending = null;
        clearTimeout(old.timer);
        if (old.element.getAttribute(MARKER) === old.id) old.element.removeAttribute(MARKER);
        old.reject(error || abortError('Fullscreen request was canceled.'));
    }

    function beginWindowed(request) {
        request.element.setAttribute(MARKER, request.id);
        // The isolated content script acknowledges only this ID, not the first matching marker.
        emit('enter', {id: request.id});
        request.timer = setTimeout(() => {
            if (pending === request) clearPending(new DOMException('Fullscreen content script did not respond.', 'NotSupportedError'));
        }, 4000);
    }

    function nativeFromPending(request) {
        if (pending !== request) return;
        pending = null;
        clearTimeout(request.timer);
        request.element.removeAttribute(MARKER);
        try {
            Promise.resolve(request.nativeCall()).then(request.resolve, request.reject);
        } catch (error) {
            request.reject(error);
        }
    }

    function handleChoice(id, selectedMode) {
        if (!pending || pending.id !== id) return;
        if (selectedMode === 'native') {
            nativeFromPending(pending);
        } else if (selectedMode === 'in-window') {
            beginWindowed(pending);
        } else {
            clearPending(abortError('User canceled fullscreen.'));
        }
    }

    function beginRequest(element, nativeCall) {
        if (currentElement) exitSimulatedFullscreen();
        if (pending) clearPending(abortError('Another fullscreen request replaced this one.'));
        const id = `vfp-${Date.now()}-${++requestCounter}-${Math.random().toString(36).slice(2)}`;
        return new Promise((resolve, reject) => {
            pending = {id, element, nativeCall, resolve, reject, timer: null};
            if (!modeIsReady) {
                emit('mode-query');
            } else if (mode === 'native') {
                nativeFromPending(pending);
            } else if (mode === 'in-window') {
                beginWindowed(pending);
            } else {
                emit('choice-request', {id});
            }
        });
    }

    function enterConfirmed(id) {
        if (pending && pending.id === id) {
            const request = pending;
            pending = null;
            clearTimeout(request.timer);
            currentElement = request.element;
            currentId = id;
            dispatchFullscreenEvents();
            request.resolve();
            return;
        }
        // A child iframe was fullscreened: expose that iframe as the parent's fullscreenElement.
        const frame = findMarkedElement(document, id);
        if (frame?.tagName === 'IFRAME') {
            currentElement = frame;
            currentId = id;
            dispatchFullscreenEvents();
        }
    }

    function exitSimulatedFullscreen() {
        if (!currentElement) return;
        const oldElement = currentElement;
        const id = currentId;
        currentElement = null;
        currentId = null;
        if (oldElement.getAttribute(MARKER) === id) oldElement.removeAttribute(MARKER);
        emit('exit', {id});
        dispatchFullscreenEvents(oldElement);
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window || event.data?.channel !== CHANNEL) return;
        const data = event.data;
        switch (data.type) {
            case 'mode-update':
                mode = MODES.has(data.mode) ? data.mode : 'ask';
                modeIsReady = true;
                if (pending && !pending.timer) {
                    if (mode === 'native') nativeFromPending(pending);
                    else if (mode === 'in-window') beginWindowed(pending);
                    else emit('choice-request', {id: pending.id});
                }
                break;
            case 'choice-response':
                handleChoice(data.id, data.mode);
                break;
            case 'enter-confirm':
                enterConfirmed(data.id);
                break;
            case 'enter-fail':
                if (pending?.id === data.id) {
                    clearPending(new DOMException(data.reason || 'Cannot locate fullscreen element.', 'NotSupportedError'));
                }
                break;
            case 'force-exit':
                exitSimulatedFullscreen();
                break;
        }
    });

    for (const name of requests) {
        const original = Element.prototype[name];
        if (typeof original !== 'function') continue;
        try {
            Object.defineProperty(Element.prototype, name, {
                configurable: true,
                writable: true,
                value: function (...args) {
                    if (modeIsReady && mode === 'native') return original.apply(this, args);
                    return beginRequest(this, () => original.apply(this, args));
                }
            });
        } catch (e) {
            console.debug('[VideoFullscreen Pro] Cannot hook', name, e);
        }
    }

    for (const name of exits) {
        const original = Document.prototype[name];
        if (typeof original !== 'function') continue;
        try {
            Object.defineProperty(Document.prototype, name, {
                configurable: true,
                writable: true,
                value: function (...args) {
                    if (currentElement) {
                        exitSimulatedFullscreen();
                        return Promise.resolve();
                    }
                    if (pending) {
                        clearPending(abortError('Fullscreen request was canceled.'));
                        return Promise.resolve();
                    }
                    return original.apply(this, args);
                }
            });
        } catch (e) {
            console.debug('[VideoFullscreen Pro] Cannot hook', name, e);
        }
    }

    document.addEventListener('fullscreenchange', event => {
        if (event.detail?.windowedFullscreen) return;
        // A native fullscreen transition must not leave our simulated fullscreen behind.
        if (currentElement && nativeGetters.get('fullscreenElement')?.call(document)) {
            exitSimulatedFullscreen();
        }
    });
})();
