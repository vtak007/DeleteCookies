# Advanced Cookie Cleaner

A Manifest V3 Chrome extension that thoroughly clears cookies for the site in the active tab —
one click, no popup, no options page.

## What it does

Clicking the toolbar icon clears cookies for the current tab's domain using a layered approach,
since a single deletion method often misses cookies set with unusual domain/path combinations:

1. **API deletion** — reads every cookie in the browser (`chrome.cookies.getAll`), matches
   against both the exact hostname and its base domain (e.g. `www.example.com` and
   `example.com`), then removes each match via `chrome.cookies.remove` for both `http://` and
   `https://` variants of the URL.
2. **Verification pass** — re-scans cookies for the domain after the API deletion to see what,
   if anything, is still present.
3. **Direct deletion fallback** — for anything left over, injects a content script into the page
   that overwrites `document.cookie` across a range of path/domain combinations (covers cookies
   the extension API alone can't reach).
4. **Reload retry** — if cookies still remain after the direct pass, force-reloads the page once
   and retries, since some cookies are only clearable once in-page state resets.

Progress and results are logged to the extension's service worker console; a final `alert()` on
the page reports how many cookies were cleared (and whether any resisted deletion).

## Install (unpacked)

1. Clone or download this repo.
2. In Chrome, go to `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select this folder.

## Usage

Navigate to any site, click the extension's toolbar icon, and confirm the alert showing how many
cookies were cleared for that domain.

## Permissions

| Permission | Why |
|---|---|
| `cookies` | Read and remove cookies for the active tab's domain |
| `scripting` | Inject the fallback deletion script and show result alerts on the page |
| `activeTab` | Identify the current tab without requiring broad host access |
| `storage` | Track reload-retry state across a forced page reload |
| `host_permissions: <all_urls>` | Cookie APIs are host-scoped in MV3; needed to act on whichever site the active tab happens to be |
