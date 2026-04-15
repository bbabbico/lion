/*
 * popup.js — Event Blaster 팝업 스크립트
 * URL 추출 → API 호출 → 랜덤 20~30개 배치 선택 → content.js 전달
 * 실행 성공/실패 로그 포함 (팝업 + 서버)
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

    // ──────────────────────────────────────
    // Priority pool (UI 함수 우선)
    // ──────────────────────────────────────
    const visualKeywords = [
      'show', 'hide', 'toggle', 'open', 'close', 'modal', 'popup',
      'dialog', 'alert', 'render', 'update', 'paint', 'draw',
      'animate', 'play', 'expand', 'collapse', 'scroll', 'nav',
      'menu', 'tab', 'click', 'submit'
    ];
    const uiFunctions = data.functions.filter(f =>
      visualKeywords.some(kw => f.name.toLowerCase().includes(kw))
    );
    const eventFunctions = data.functions.filter(f => f.type === 'event');
    const priorityPool = uiFunctions.length > 0 ? uiFunctions
      : eventFunctions.length > 0 ? eventFunctions
      : data.functions;

    // 사용자 입력 수 만큼 선택
    const countInput = document.getElementById('functionCount');
    const requestedCount = parseInt(countInput.value, 10) || 30;
    const batchCount = Math.min(requestedCount, data.functions.length);

    // 우선순위 풀에서 먼저, 부족하면 전체에서 보충
    const shuffled = [...priorityPool].sort(() => Math.random() - 0.5);
    const rest = data.functions.filter(f => !priorityPool.includes(f)).sort(() => Math.random() - 0.5);
    const batch = [...shuffled, ...rest].slice(0, batchCount);

    statusText.textContent = `🎯 Blasting ${batch.length} functions... FIRING!!!`;
    statusText.className = 'status-text success';
    lastExecEl.textContent = `${batch.length}개 함수 배치 실행 중...`;

    addLogEntry(`🚀 BATCH FIRE: ${batch.length}개 함수 실행 시작 (우선 UI ${uiFunctions.length}개)`);

    // Send EXECUTE_BATCH to content script and await results
    chrome.tabs.sendMessage(currentTabId, {
      action: 'EXECUTE_BATCH',
      fns: batch,
      url: currentUrl
    }, (result) => {
      if (chrome.runtime.lastError) {
        addLogEntry(`❌ 메시지 전송 실패: ${chrome.runtime.lastError.message}`);
        return;
      }
      if (!result) return;

      const { successes = [], failures = [] } = result;

      // 성공 로그
      successes.forEach(s => {
        addLogEntry(`✅ EXECUTED: ${s.name}() [${s.method}]`);
      });

      // 실패 로그 (팝업 + 서버)
      failures.forEach(f => {
        addLogEntry(`❌ FAILED: ${f.name}() — ${f.error}`);
        // 서버에도 전송
        fetch(`${BACKEND_URL}/api/log-client`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: currentUrl, fnName: f.name, error: f.error })
        }).catch(() => {});
      });

      lastExecEl.textContent = `✅ ${successes.length}개 성공 / ❌ ${failures.length}개 실패`;
    });

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
