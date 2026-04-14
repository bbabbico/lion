/*
 * popup.js — Event Blaster 팝업 스크립트
 * URL 추출 → API 호출 → 랜덤 선택 → content.js 전달
 * 서버 로그 기능 포함
 */

const BACKEND_URL = 'http://localhost:3000';

// DOM elements
const currentUrlEl = document.getElementById('currentUrl');
const blastBtn = document.getElementById('blastBtn');
const cancelBtn = document.getElementById('cancelBtn');
const statusText = document.getElementById('statusText');
const lastExecEl = document.getElementById('lastExec');
const logEntriesEl = document.getElementById('logEntries');

let currentTabId = null;
let currentUrl = '';
let isBlasting = false;

// ──────────────────────────────────────
// Initialization
// ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      currentTabId = tab.id;
      currentUrl = tab.url || '';
      currentUrlEl.textContent = currentUrl || 'No URL detected';
    }
  } catch (err) {
    currentUrlEl.textContent = 'Error getting URL';
    console.error(err);
  }

  // Load logs from storage
  loadLogs();
});

// ──────────────────────────────────────
// BLAST Button
// ──────────────────────────────────────
blastBtn.addEventListener('click', async () => {
  if (isBlasting || !currentUrl) return;

  if (currentUrl.startsWith('chrome://') || currentUrl.startsWith('chrome-extension://')) {
    statusText.textContent = '❌ Cannot blast Chrome internal pages!';
    statusText.className = 'status-text error';
    return;
  }

  isBlasting = true;
  blastBtn.disabled = true;
  cancelBtn.style.display = 'block';
  statusText.textContent = '⏳ Sending START_WAIT to page...';
  statusText.className = 'status-text';

  // Inject content script if needed and send START_WAIT
  try {
    await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      files: ['src/content.js']
    });
  } catch (e) {
    // Already injected, ignore
  }

  // Small delay to let content script initialize
  await sleep(200);

  // Send START_WAIT message
  chrome.tabs.sendMessage(currentTabId, { action: 'START_WAIT', url: currentUrl });

  statusText.textContent = '🔍 Parsing target site... STAND BY!!!';

  // Call backend API
  try {
    const response = await fetch(`${BACKEND_URL}/api/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: currentUrl })
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.functions || data.functions.length === 0) {
      statusText.textContent = '😢 No functions found on this page!!!';
      statusText.className = 'status-text error';
      chrome.tabs.sendMessage(currentTabId, { action: 'CANCEL' });
      resetState();
      return;
    }

    // Add server log entries
    addServerLog(data);

    // Random selection
    const randomIndex = Math.floor(Math.random() * data.functions.length);
    const selected = data.functions[randomIndex];

    statusText.textContent = `🎯 Selected: ${selected.name} (${selected.type}) from ${selected.source}!!!`;
    statusText.className = 'status-text success';
    lastExecEl.textContent = `${selected.name}() — ${selected.type}`;

    // Send EXECUTE_FN to content script
    chrome.tabs.sendMessage(currentTabId, {
      action: 'EXECUTE_FN',
      fn: selected
    });

    // Log the execution
    addLogEntry(`EXECUTED: ${selected.name}() [${selected.type}] from ${selected.source}`);

  } catch (err) {
    console.error('Blast error:', err);
    statusText.textContent = `💥 ERROR: ${err.message}`;
    statusText.className = 'status-text error';
    chrome.tabs.sendMessage(currentTabId, { action: 'CANCEL' });
  }

  resetState();
});

// ──────────────────────────────────────
// Cancel Button
// ──────────────────────────────────────
cancelBtn.addEventListener('click', () => {
  if (currentTabId) {
    chrome.tabs.sendMessage(currentTabId, { action: 'CANCEL' });
  }
  statusText.textContent = '🚫 CANCELLED!!!';
  statusText.className = 'status-text error';
  resetState();
});

// ──────────────────────────────────────
// Helpers
// ──────────────────────────────────────
function resetState() {
  isBlasting = false;
  blastBtn.disabled = false;
  cancelBtn.style.display = 'none';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ──────────────────────────────────────
// Server Log Functions
// ──────────────────────────────────────
function addServerLog(data) {
  const timestamp = new Date().toLocaleTimeString();
  const total = data.functions.length;

  // Log each function/event the server returned
  addLogEntry(`[${timestamp}] Server returned ${total} items from ${data.url}`);

  data.functions.forEach((fn, i) => {
    addLogEntry(`  #${i + 1} ${fn.name} (${fn.type}) — ${fn.source}`);
  });
}

function addLogEntry(text) {
  // Remove "no logs" placeholder
  const placeholder = logEntriesEl.querySelector('.log-entry[style]');
  if (placeholder && placeholder.textContent.includes('No logs')) {
    placeholder.remove();
  }

  const entry = document.createElement('div');
  entry.className = 'log-entry';

  // Parse and colorize
  const timestamp = new Date().toLocaleTimeString();
  if (text.startsWith('  #')) {
    // Individual function entry
    entry.innerHTML = `<span class="log-time">${timestamp}</span> <span class="log-fn">${escapeHtml(text)}</span>`;
  } else if (text.includes('EXECUTED')) {
    entry.innerHTML = `<span class="log-time">${timestamp}</span> <span style="color:#ff0;">⚡${escapeHtml(text)}</span>`;
  } else {
    entry.innerHTML = `<span class="log-time">${timestamp}</span> <span class="log-source">${escapeHtml(text)}</span>`;
  }

  logEntriesEl.appendChild(entry);
  logEntriesEl.scrollTop = logEntriesEl.scrollHeight;

  // Save to storage
  saveLogs();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function saveLogs() {
  const logs = logEntriesEl.innerHTML;
  chrome.storage?.local?.set({ eventBlasterLogs: logs });
}

function loadLogs() {
  chrome.storage?.local?.get('eventBlasterLogs', (result) => {
    if (result && result.eventBlasterLogs) {
      logEntriesEl.innerHTML = result.eventBlasterLogs;
    }
  });
}
