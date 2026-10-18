document.querySelector('.choice-backdrop').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) {
        window.parent.postMessage({type: 'fullscreen-choice-dismiss'}, '*');
        return;
    }

    const button = event.target.closest('button[data-mode]');
    if (button) {
        window.parent.postMessage({
            type: 'fullscreen-choice-selected',
            mode: button.dataset.mode
        }, '*');
    }
});