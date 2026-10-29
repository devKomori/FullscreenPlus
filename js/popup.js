const radioGroup = 'input[name="mode"]';
const siteHost = document.getElementById('siteHost');
const banner = document.getElementById('banner');
const settingsView = document.getElementById('settingsView');
const statusEl = document.getElementById('status');
let activeSite = null;

const LABELS = {'in-window': 'In-window fullscreen', 'native': 'Native fullscreen', 'ask': 'Ask every time'};


document.addEventListener('DOMContentLoaded', async () => {
    try {
        const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
        if (!tab?.url) {
            showUnsupported();
            return;
        }
        const url = new URL(tab.url);
        if (!['http:', 'https:'].includes(url.protocol) || url.hostname.includes('chromewebstore.google.com')) {
            showUnsupported();
            return;
        }

        activeSite = {tab, hostname: url.hostname};
        siteHost.textContent = url.hostname.replace(/^www\./, '');
        document.querySelector('.version').textContent =
            `v${chrome.runtime.getManifest().version}`;


        // We need to check if the page needs a refresh (e.g., the extension was just installed)
        const sessionData = await chrome.storage.session.get(`needsRefresh_${tab.id}`);
        if (sessionData[`needsRefresh_${tab.id}`]) {
            await showRefreshPage();
            return;
        }

        const result = await chrome.storage.sync.get('fullscreenPreferences');
        const preferences = result.fullscreenPreferences || {};
        const mode = preferences[url.hostname] || 'ask';

        const selectedRadio = document.querySelector(`${radioGroup}[value="${mode}"]`);
        if (selectedRadio) selectedRadio.checked = true;

        try {
            await chrome.tabs.sendMessage(tab.id, {type: 'fullscreen-mode-update', mode});

        } catch (error) {
            await showRefreshPage();
        }

    } catch (e) {
        showUnsupported();
    }
});


function showUnsupported() {
    banner.style.display = 'flex';
    document.getElementsByClassName('site-info')[0].style.display = 'none';
    settingsView.classList.add('disabled');
    document.querySelectorAll(radioGroup).forEach(r => r.disabled = true);
    statusEl.textContent = 'Unavailable';
}


async function showRefreshPage() {
    // Flag the tab to indicate that it needs a refresh to enable the extension
    if (activeSite?.tab?.id) {
        await chrome.storage.session.set({[`needsRefresh_${activeSite.tab.id}`]: true});
    }
    banner.style.display = 'flex';
    banner.style.cursor = 'pointer';
    banner.querySelector('.banner-title').textContent = 'Refresh page';
    banner.querySelector('.banner-text').textContent = 'Refresh to enable the extension.';
    banner.querySelector('.banner-icon').textContent = '⭮';
    banner.querySelector('.banner-icon').style.color = '#fff';

    banner.onclick = async () => {
        if (!activeSite?.tab?.id) return;
        // Remove the refresh flag and reload the tab
        await chrome.storage.session.remove(`needsRefresh_${activeSite.tab.id}`);
        await chrome.tabs.reload(activeSite.tab.id);
        window.close();
    };
    document.getElementsByClassName('site-info')[0].style.display = 'none';
    settingsView.classList.add('disabled');
    document.querySelectorAll(radioGroup).forEach(r => r.disabled = true);
    statusEl.textContent = 'Refresh required';
}


document.querySelectorAll(radioGroup).forEach(radio => {
    radio.addEventListener('change', async (event) => {
        if (!activeSite) return;
        const mode = event.target.value;

        const result = await chrome.storage.sync.get('fullscreenPreferences');
        const preferences = result.fullscreenPreferences || {};
        preferences[activeSite.hostname] = mode;
        await chrome.storage.sync.set({fullscreenPreferences: preferences});

        chrome.tabs.sendMessage(activeSite.tab.id, {type: 'fullscreen-mode-update', mode}).catch(() => {
        });

        statusEl.textContent = `✓ Saved - ${LABELS[mode]} on ${activeSite.hostname}`;
        statusEl.classList.add('saved');
        setTimeout(() => {
            statusEl.classList.remove('saved');
            statusEl.textContent = 'Ready';
        }, 2000);
    });
});


// volume.js - Handles volume boost slider in the popup

const volumeBoostSlider = document.getElementById('volumeBoost');
const volumeValueDisplay = document.getElementById('volumeValue');

// Initialize when popup opens
document.addEventListener('DOMContentLoaded', async () => {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab?.id) return;

    try {
        const response = await chrome.runtime.sendMessage({type: 'get-volume-boost', tabId: tab.id});
        const currentVolume = response?.volume || 100;

        volumeBoostSlider.value = currentVolume;
        volumeValueDisplay.textContent = `${currentVolume}%`;
    } catch (error) {
        // Content script not loaded yet, default to 100%
        volumeBoostSlider.value = 100;
        volumeValueDisplay.textContent = '100%';
    }
});

// Handle slider changes
volumeBoostSlider.addEventListener('input', async (event) => {
    const boost = parseInt(event.target.value, 10);
    volumeValueDisplay.textContent = `${boost}%`;

    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab?.id) return;

    chrome.runtime.sendMessage({
        type: 'volume-boost-update',
        tabId: tab.id,
        volume: boost
    }).then(response => {
        if (!response?.success) {
            console.warn('Volume boost failed:', response?.error);
        }
    }).catch(console.error);
});