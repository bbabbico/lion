const SAFE_SELECTORS = 'a[href], button, [role="button"], input[type="submit"], input[type="button"]';

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'START_LOCAL_SCAN') {
    runLocalBurst(message.payload?.burstCount ?? 4);
  }

  if (message.action === 'APPLY_SERVER_ACTIONS') {
    applyServerActions(message.payload?.executedActions || []);
  }
});

function getVisibleCandidates() {
  const all = Array.from(document.querySelectorAll(SAFE_SELECTORS));
  return all.filter((el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  });
}

function markAndClick(target, color) {
  const originalOutline = target.style.outline;
  target.style.outline = `3px solid ${color}`;
  target.style.outlineOffset = '2px';

  setTimeout(() => {
    target.style.outline = originalOutline;
    target.click();
  }, 120);
}

function runLocalBurst(count) {
  const candidates = getVisibleCandidates();
  if (candidates.length === 0) {
    console.info('[Lion] 로컬 실행 후보가 없습니다.');
    return;
  }

  const maxCount = Math.min(count, candidates.length);
  const shuffled = candidates.sort(() => Math.random() - 0.5).slice(0, maxCount);

  shuffled.forEach((target, index) => {
    setTimeout(() => {
      if (target.tagName.toLowerCase() === 'a') {
        target.setAttribute('target', '_blank');
      }
      markAndClick(target, '#ef4444');
    }, index * 200);
  });
}

function applyServerActions(actions) {
  if (!actions.length) {
    console.info('[Lion] 서버 실행 액션이 없습니다.');
    return;
  }

  actions.forEach((action, index) => {
    setTimeout(() => {
      const el = document.querySelector(action.selector);
      if (!el) {
        return;
      }

      if (action.type === 'click') {
        if (el.tagName.toLowerCase() === 'a') {
          el.setAttribute('target', '_blank');
        }
        markAndClick(el, '#2563eb');
      }
    }, index * 250);
  });
}
