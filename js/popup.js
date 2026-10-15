const radioGroup = 'input[name="fullscreen-setting"]';
const savedSetting = localStorage.getItem("userChoice");
const websiteName = document.getElementById('website-name');


function showUnsupportedPage() {
    document.body.innerHTML = `
        <div class="unsupported-page">
            <h2>Fullscreen <span class="accent">+</span></h2>
            <p>This extension is not supported on this page.</p>
        </div>
    `;
}

async function getActiveTab() {
    try {
        const [tab] = await chrome.tabs.query({
            active: true,
            lastFocusedWindow: true
        });
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
    } catch {
        showUnsupportedPage();
    }
}
getActiveTab();


// Load: set the radio button based on the saved setting in localStorage
if (savedSetting) {
    // If a setting has been saved, use it
    const selectedRadio = document.querySelector(`${radioGroup}[value="${savedSetting}"]`);
    if (selectedRadio) {
        selectedRadio.checked = true;
    }
} else {
    // If a setting has not been saved yet, default to ask
    const defaultRadio = document.querySelector(`${radioGroup}[value="ask"]`);
    if (defaultRadio) {
        defaultRadio.checked = true;
    }
}

document.querySelectorAll(radioGroup).forEach((radio) => {
    radio.addEventListener('change', (e) => {
        const selectedValue = e.target.value;

        // Save using the exact matching key string
        localStorage.setItem('userChoice', selectedValue);
    });
});