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
            await chrome.tabs.sendMessage(tab.id, {
                type: 'fullscreen-mode-update',
                mode
            });
        } catch (error) {
            await showRefreshPage();
        }

    } catch (e) {
        showUnsupported();
    }
});


function showUnsupported() {
    banner.style.display = 'flex';
    settingsView.classList.add('disabled');
    document.querySelectorAll(radioGroup).forEach(r => r.disabled = true);
    statusEl.textContent = 'Unavailable';
}


async function showRefreshPage() {
    // Flag the tab to indicate that it needs a refresh to enable the extension
    if (activeSite?.tab?.id) {
        await chrome.storage.session.set({[`needsRefresh_${activeSite.tab.id}`]: true});
    }
    chrome.action.setTitle({title: 'Restart your browser or refresh on tabs to enable the extension'});
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