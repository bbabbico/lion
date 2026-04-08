const CLICKABLE_SELECTORS = 'a[href], button, [role="button"], input[type="submit"], input[type="button"], [aria-haspopup="menu"]';
const INPUT_SELECTORS = 'input[type="text"], input[type="search"], input[type="email"], textarea';
const SELECT_SELECTORS = 'select';

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'START_LOCAL_SCAN') {
    runLocalBurst(message.payload?.burstCount ?? 8);
  }

  if (message.action === 'APPLY_SERVER_ACTIONS') {
    applyServerActions(message.payload?.executedActions || []);
  }
});

function isVisible(el) {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}

function getVisible(selector) {
  return Array.from(document.querySelectorAll(selector)).filter(isVisible);
}

function randomPick(items) {
  if (!items.length) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function markElement(target, color) {
  const old = target.style.outline;
  target.style.outline = `3px solid ${color}`;
  target.style.outlineOffset = '2px';
  setTimeout(() => {
    target.style.outline = old;
  }, 260);
}

function clickRandom() {
  const target = randomPick(getVisible(CLICKABLE_SELECTORS));
  if (!target) return;

  if (target.tagName.toLowerCase() === 'a') {
    target.setAttribute('target', '_blank');
  }

  markElement(target, '#ef4444');
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function fillRandomInput() {
  const target = randomPick(getVisible(INPUT_SELECTORS));
  if (!target) return;

  markElement(target, '#f59e0b');
  const value = `lion_${Math.random().toString(36).slice(2, 8)}`;
  target.focus();
  target.value = value;
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
}

function chooseRandomOption() {
  const target = randomPick(getVisible(SELECT_SELECTORS));
  if (!target || !target.options.length) return;

  const pick = Math.floor(Math.random() * target.options.length);
  markElement(target, '#8b5cf6');
  target.selectedIndex = pick;
  target.dispatchEvent(new Event('change', { bubbles: true }));
}

function runLocalBurst(count) {
  const actionFns = [clickRandom, fillRandomInput, chooseRandomOption];

  for (let i = 0; i < count; i += 1) {
    const fn = actionFns[i % actionFns.length];
    setTimeout(() => {
      try {
        fn();
      } catch (error) {
        console.info('[Lion] local action skip', error?.message || error);
      }
    }, i * 180);
  }
}

function applyServerActions(actions) {
  if (!actions.length) {
    console.info('[Lion] 서버 액션이 없습니다.');
    return;
  }

  actions.forEach((action, index) => {
    setTimeout(() => {
      try {
        if (action.type === 'navigate' && action.url) {
          window.open(action.url, '_blank', 'noopener,noreferrer');
          return;
        }

        if (!action.selector) return;
        const el = document.querySelector(action.selector);
        if (!el) return;

        if (action.type === 'click') {
          if (el.tagName.toLowerCase() === 'a') {
            el.setAttribute('target', '_blank');
          }
          markElement(el, '#2563eb');
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }

        if (action.type === 'fill' && typeof action.value === 'string') {
          markElement(el, '#22c55e');
          el.focus();
          el.value = action.value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } catch (error) {
        console.info('[Lion] server action skip', error?.message || error);
      }
    }, index * 240);
  });
}
