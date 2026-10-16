const radioGroup = 'input[name="fullscreen-setting"]';
const websiteName = document.getElementById('website-name');
let activeSite = null;


function showUnsupportedPage() {
    document.body.innerHTML = `
        <div class="unsupported-page">
            <h2>Fullscreen <span class="accent">+</span></h2>
            <p>This extension is not supported on this page.</p>
        </div>
    `;
}

function showRefreshPage() {
    document.body.innerHTML = `
        <div class="refresh-page">
            <h2>Fullscreen <span class="accent">+</span></h2>
            <p>Refresh the page to enable the extension</p>
            <button id="refresh-page-button" type="button">Refresh page</button>
        </div>
    `;

    document.getElementById('refresh-page-button')
        .addEventListener('click', async (event) => {
            const button = event.currentTarget;
            button.disabled = true;

            try {
                await chrome.tabs.reload(activeSite.tab.id);
                window.close();
            } catch (error) {
                button.disabled = false;
                console.error('Unable to refresh the page:', error);
            }
        });
}


async function getActiveTab() {
    try {
        const [tab] = await chrome.tabs.query({active: true, lastFocusedWindow: true});

        if (!tab?.url) {
            showUnsupportedPage();
            return;
        }
        const url = new URL(tab.url);

        if (!['http:', 'https:'].includes(url.protocol)) {
            showUnsupportedPage();
            return;
        }
        websiteName.textContent = url.hostname.replace(/^www\./, '');
        return {
            tab,
            hostname: url.hostname.replace(/^www\./, '')
        };
    } catch {
        showUnsupportedPage();
    }
}


async function getPreferences() {
    const result = await chrome.storage.local.get('fullscreenPreferences');
    return result.fullscreenPreferences || {}; // Return an empty object if no preferences are found
}


async function sendMode(mode) {
    if (!activeSite) {
        return;
    }
    try {
        await chrome.tabs.sendMessage(activeSite.tab.id, {type: 'fullscreen-mode-update', mode});
        return true;
    }
    catch (error) {
        if (error?.message.includes('Receiving end does not exist')) {
            showRefreshPage();
            return false;
        }
        throw error;
    }
}


async function loadSetting() {
    if (!activeSite) {
        return;
    }
    const preferences = await getPreferences();
    const mode = preferences[activeSite.hostname] || 'ask';

    const selectedRadio = document.querySelector(`${radioGroup}[value="${mode}"]`);
    if (selectedRadio) {
        selectedRadio.checked = true;
    }
    await sendMode(mode);
}


async function saveSetting(mode) {
    if (!activeSite) {
        return;
    }
    const preferences = await getPreferences();
    preferences[activeSite.hostname] = mode;

    await chrome.storage.local.set({fullscreenPreferences: preferences});
    await sendMode(mode);
}

document.querySelectorAll(radioGroup).forEach((radio) => {
    radio.addEventListener('change', async (event) => {
        await saveSetting(event.target.value);
    });
});


async function initSettings() {
    activeSite = await getActiveTab();
    if (activeSite) {
        await loadSetting();
    }
}

initSettings();
