// ISOLATED world: locate the exact requested element, manage CSS and iframe propagation.
(() => {
    if (window.__vfpContentInstalled) return;
    window.__vfpContentInstalled = true;

    const CHANNEL = 'vfp-compat-v2';
    const MARKER = 'data-vfp-request-id';
    const ACTIVE = 'data-vfp-active';
    const ANCESTOR = 'data-vfp-ancestor';
    const HIDDEN = 'data-vfp-hidden';
    const LOCKED = 'data-vfp-locked';
    const MODES = new Set(['ask', 'in-window', 'native']);

    let currentMode = 'ask';
    let modeReady = false;
    let active = null;
    let fullscreenChoiceOverlay = null;
    let fullscreenChoiceTarget = null;
    let choiceChild = null;
    let choiceRequestId = null;
    let detachTimer = null;

    const emit = (type, extra = {}) =>
        window.postMessage({channel: CHANNEL, type, ...extra}, '*');
    const toParent = (type, extra = {}) => {
        if (window.parent !== window) {
            window.parent.postMessage({channel: CHANNEL, type, ...extra}, '*');
        }
    };
    const isTop = window.parent === window;

    function sendModeToPage() {
        if (active) return; // Do not switch the interception mode halfway through fullscreen.
        emit('mode-update', {mode: currentMode});
    }

    function sendModeToChildren() {
        const frames = collectElements(document, el => el.tagName === 'IFRAME');
        for (const frame of frames) {
            try {
                frame.contentWindow?.postMessage({
                    channel: CHANNEL, type: 'frame-mode', mode: currentMode
                }, '*');
            } catch (_) { /* Inaccessible iframe */
            }
        }
    }

    function setMode(value) {
        currentMode = MODES.has(value) ? value : 'ask';
        modeReady = true;
        sendModeToPage();
        sendModeToChildren();
        if (currentMode !== 'ask' && fullscreenChoiceOverlay) dismissChoice();
    }

    async function loadMode() {
        if (!isTop) return;
        try {
            const result = await chrome.storage.sync.get('fullscreenPreferences');
            const hostname = location.hostname;
            setMode(result.fullscreenPreferences?.[hostname] || 'ask');
        } catch (error) {
            console.warn('[VideoFullscreen Pro] Could not load fullscreen preference:', error);
            setMode('ask');
        }
    }

    function collectElements(root, predicate) {
        const result = [];
        const visit = current => {
            for (const element of current.querySelectorAll?.('*') || []) {
                if (predicate(element)) result.push(element);
                if (element.shadowRoot) visit(element.shadowRoot);
            }
        };
        visit(root);
        return result;
    }

    function getMarkedElement(id) {
        return collectElements(document, el => el.getAttribute(MARKER) === id)[0] || null;
    }

    function getFrameForSource(source) {
        return collectElements(document, el => el.tagName === 'IFRAME')
            .find(frame => frame.contentWindow === source) || null;
    }

    // Track precisely which attributes the extension added so exit is reversible.
    function putAttribute(state, element, name) {
        if (!element || state.saved.get(element)?.has(name)) return;
        let props = state.saved.get(element);
        if (!props) {
            props = new Map();
            state.saved.set(element, props);
        }
        props.set(name, element.getAttribute(name));
        element.setAttribute(name, '');
    }

    // A few players use inline !important declarations that beat injected CSS.
    // Override only conflicting values; preserve and restore every original value.
    function setInline(state, element, property, value) {
        let original = state.inline.get(element);
        if (!original) {
            original = new Map();
            state.inline.set(element, original);
        }
        if (!original.has(property)) {
            original.set(property, {
                value: element.style.getPropertyValue(property),
                priority: element.style.getPropertyPriority(property)
            });
        }
        if (element.style.getPropertyValue(property) !== value ||
            element.style.getPropertyPriority(property) !== 'important') {
            element.style.setProperty(property, value, 'important');
        }
    }

    function fixBlockingInlineStyles(state, element, ancestor) {
        const computed = getComputedStyle(element);
        const required = ancestor ? {
            'transform': 'none', 'translate': 'none', 'scale': 'none',
            'rotate': 'none', 'perspective': 'none', 'filter': 'none',
            'contain': 'none',
            'overflow': (element === document.documentElement || element === document.body) ? 'hidden' : 'visible',
            'opacity': '1',
            'will-change': 'auto', 'clip-path': 'none'
        } : {'position': 'fixed', 'transform': 'none', 'contain': 'none'};
        for (const [property, expected] of Object.entries(required)) {
            const actual = computed.getPropertyValue(property).trim();
            if (actual !== expected) setInline(state, element, property, expected);
        }
        if (!ancestor) {
            const rect = element.getBoundingClientRect();
            if (Math.abs(rect.left) > 1 || Math.abs(rect.top) > 1 ||
                Math.abs(rect.width - innerWidth) > 2 ||
                Math.abs(rect.height - innerHeight) > 2) {
                for (const [property, value] of Object.entries({
                    position: 'fixed', top: '0', right: '0', bottom: '0',
                    left: '0', width: '100vw', height: '100vh',
                    'max-width': 'none', 'max-height': 'none',
                    margin: '0', 'z-index': '2147483646'
                })) setInline(state, element, property, value);
            }
            if (element.tagName === 'IFRAME') setInline(state, element, 'border', '0');
        }
    }

    const SHADOW_CSS = `
        [data-vfp-hidden] { visibility: hidden !important; pointer-events: none !important; }
        [data-vfp-ancestor] {
            transform: none !important; translate: none !important; scale: none !important;
            rotate: none !important; perspective: none !important;
            filter: none !important; backdrop-filter: none !important;
            contain: none !important; content-visibility: visible !important;
            opacity: 1 !important; overflow: visible !important;
            clip-path: none !important; mask: none !important;
            isolation: auto !important; will-change: auto !important;
            visibility: visible !important;
        }
        [data-vfp-active] {
            position: fixed !important; inset: 0 !important;
            width: 100vw !important; height: 100vh !important;
            min-width: 0 !important; min-height: 0 !important;
            max-width: none !important; max-height: none !important;
            margin: 0 !important; box-sizing: border-box !important;
            z-index: 2147483646 !important;
            visibility: visible !important; opacity: 1 !important;
            transform: none !important; contain: none !important;
            background: black !important;
        }
        iframe[data-vfp-active] { border: 0 !important; padding: 0 !important; }
    `;

    function ensureShadowStyle(state, root) {
        if (!(root instanceof ShadowRoot) || state.shadowStyles.has(root)) return;
        const style = document.createElement('style');
        style.textContent = SHADOW_CSS;
        root.appendChild(style);
        state.shadowStyles.set(root, style);
        state.observer.observe(root, {childList: true, subtree: true});
    }

    function markSiblings(state, parent, branch) {
        for (const sibling of parent.children || []) {
            if (sibling === branch || sibling === fullscreenChoiceOverlay) continue;
            if (['SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE'].includes(sibling.tagName)) continue;
            putAttribute(state, sibling, HIDDEN);
        }
    }

    function refreshLayout(state) {
        let branch = state.element;
        if (!branch.isConnected) return;
        putAttribute(state, branch, ACTIVE);
        const ancestors = [];

        while (branch) {
            const parent = branch.parentElement;
            if (parent) {
                markSiblings(state, parent, branch);
                putAttribute(state, parent, ANCESTOR);
                ancestors.push(parent);
                branch = parent;
                continue;
            }
            const root = branch.getRootNode();
            if (root instanceof ShadowRoot) {
                ensureShadowStyle(state, root);
                markSiblings(state, root, branch);
                branch = root.host;
                putAttribute(state, branch, ANCESTOR);
                ancestors.push(branch);
            } else {
                break;
            }
        }
        putAttribute(state, document.documentElement, LOCKED);
        if (document.body) putAttribute(state, document.body, LOCKED);
        for (const ancestor of ancestors) fixBlockingInlineStyles(state, ancestor, true);
        fixBlockingInlineStyles(state, state.element, false);
    }

    function cleanUpActive() {
        if (!active) return null;
        const old = active;
        active = null;
        clearTimeout(detachTimer);
        detachTimer = null;
        old.observer.disconnect();
        for (const style of old.shadowStyles.values()) style.remove();
        for (const [element, props] of old.inline) {
            for (const [property, original] of props) {
                if (original.value) {
                    element.style.setProperty(property, original.value, original.priority);
                } else {
                    element.style.removeProperty(property);
                }
            }
        }
        for (const [element, props] of old.saved) {
            for (const [name, previous] of props) {
                if (previous === null) element.removeAttribute(name);
                else element.setAttribute(name, previous);
            }
        }
        sendModeToPage();
        return old;
    }

    function enterWindowedFullscreen(element, id, fromChild = false) {
        if (active?.element === element && active.id === id) return true;
        const previous = cleanUpActive();
        if (previous?.fromChild) {
            previous.element.contentWindow?.postMessage({
                channel: CHANNEL, type: 'frame-force-exit'
            }, '*');
        }
        if (!element?.isConnected) return false;

        const state = {
            element, id, fromChild, saved: new Map(), inline: new Map(), shadowStyles: new Map(),
            observer: new MutationObserver(() => {
                if (active !== state) return;
                if (!state.element.isConnected) {
                    if (!detachTimer) {
                        detachTimer = setTimeout(() => {
                            detachTimer = null;
                            if (active === state && !state.element.isConnected) emit('force-exit');
                        }, 150);
                    }
                    return;
                }
                refreshLayout(state); // Hide newly inserted sibling overlays too.
            })
        };
        active = state;
        state.observer.observe(document.documentElement, {childList: true, subtree: true});
        refreshLayout(state);
        if (fromChild) element.setAttribute(MARKER, id);
        emit('enter-confirm', {id});
        toParent('frame-enter', {id});
        return true;
    }

    function exitWindowedFullscreen() {
        const old = cleanUpActive();
        if (!old) return;
        if (old.fromChild) {
            try {
                old.element.contentWindow?.postMessage({
                    channel: CHANNEL, type: 'frame-force-exit'
                }, '*');
            } catch (_) { /* Frame may have navigated. */
            }
        }
        toParent('frame-exit', {id: old.id});
    }

    // Messages from the MAIN-world hook in this frame.
    function handleLocalMessage(data) {
        switch (data.type) {
            case 'mode-query':
                if (modeReady) sendModeToPage();
                else if (!isTop) toParent('frame-mode-query');
                break;
            case 'choice-request':
                choiceRequestId = data.id;
                if (isTop) showFullscreenChoice({id: data.id, local: true});
                else toParent('frame-choice-request', {id: data.id});
                break;
            case 'enter': {
                const element = getMarkedElement(data.id);
                if (!element || !enterWindowedFullscreen(element, data.id)) {
                    emit('enter-fail', {
                        id: data.id,
                        reason: 'Fullscreen target is inaccessible or was removed.'
                    });
                }
                break;
            }
            case 'exit':
                if (active?.id === data.id) exitWindowedFullscreen();
                break;
        }
    }

    function handleChildMessage(event, data) {
        const frame = getFrameForSource(event.source);
        if (!frame) return;
        switch (data.type) {
            case 'frame-mode-query':
                if (modeReady) event.source.postMessage({
                    channel: CHANNEL, type: 'frame-mode', mode: currentMode
                }, '*');
                else if (!isTop) toParent('frame-mode-query');
                break;
            case 'frame-choice-request':
                choiceChild = event.source;
                choiceRequestId = data.id;
                if (isTop) showFullscreenChoice({id: data.id, local: false});
                else toParent('frame-choice-request', {id: data.id});
                break;
            case 'frame-enter':
                enterWindowedFullscreen(frame, data.id, true);
                break;
            case 'frame-exit':
                if (active?.element === frame && active?.id === data.id) emit('force-exit');
                break;
        }
    }

    function handleParentMessage(data) {
        switch (data.type) {
            case 'frame-mode':
                setMode(data.mode);
                break;
            case 'frame-choice-response':
                if (choiceChild) {
                    choiceChild.postMessage(data, '*');
                    choiceChild = null;
                } else if (choiceRequestId === data.id) {
                    emit('choice-response', {id: data.id, mode: data.mode});
                }
                break;
            case 'frame-force-exit':
                emit('force-exit');
                break;
        }
    }

    window.addEventListener('message', event => {
        if (event.data?.channel !== CHANNEL) return;
        if (event.source === window) handleLocalMessage(event.data);
        else if (!isTop && event.source === window.parent) handleParentMessage(event.data);
        else handleChildMessage(event, event.data);
    });

    chrome.runtime.onMessage.addListener(message => {
        if (message?.type === 'fullscreen-mode-update') setMode(message.mode);
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync' || !isTop || !changes.fullscreenPreferences) return;
        const newMode = changes.fullscreenPreferences.newValue?.[location.hostname] || 'ask';
        setMode(newMode);
    });

    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        if (fullscreenChoiceOverlay) {
            event.preventDefault();
            event.stopImmediatePropagation();
            dismissChoice();
        } else if (active) {
            event.preventDefault();
            event.stopImmediatePropagation();
            emit('force-exit');
        }
    }, true);

    if (isTop) loadMode();
    else toParent('frame-mode-query');

    function showFullscreenChoice(target) {
        if (fullscreenChoiceOverlay) {
            dismissChoice();
        }
        fullscreenChoiceOverlay = document.createElement('div');
        fullscreenChoiceOverlay.className = 'fullscreen-choice-overlay';
        fullscreenChoiceTarget = target;

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
        const mount = document.documentElement || document;
        mount.appendChild(fullscreenChoiceOverlay);
    }


    function deliverChoice(mode) {
        const target = fullscreenChoiceTarget;
        if (!target) return;
        if (target.local) {
            emit('choice-response', {id: target.id, mode});
        } else if (choiceChild) {
            choiceChild.postMessage({
                channel: CHANNEL, type: 'frame-choice-response', id: target.id, mode
            }, '*');
            choiceChild = null;
        }
        choiceRequestId = null;
    }

    function selectChoice(mode) {
        deliverChoice(mode);
        removeFullscreenChoice();
    }

    function dismissChoice() {
        deliverChoice(null);
        removeFullscreenChoice();
    }

    function removeFullscreenChoice() {
        fullscreenChoiceOverlay?.remove();
        fullscreenChoiceOverlay = null;
        fullscreenChoiceTarget = null;
    }
})();
