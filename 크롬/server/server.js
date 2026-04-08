const express = require('express');
const crypto = require('crypto');
const { chromium } = require('playwright');

const app = express();
app.use(express.json({ limit: '1mb' }));

const jobs = new Map();
const proxyEventsByUrl = new Map();
const PROXY_SERVER = process.env.LION_PROXY || 'http://127.0.0.1:8080';

function nowIso() {
  return new Date().toISOString();
}

function pushProxyEvent(url, event) {
  const key = String(url || '');
  const list = proxyEventsByUrl.get(key) || [];
  list.push({ ...event, receivedAt: nowIso() });
  proxyEventsByUrl.set(key, list.slice(-100));
}

function consumeProxyEvents(url) {
  const key = String(url || '');
  const list = proxyEventsByUrl.get(key) || [];
  proxyEventsByUrl.delete(key);
  return list;
}

function createJob(url, options) {
  const jobId = crypto.randomUUID();
  const job = {
    jobId,
    url,
    options: {
      maxActions: Math.min(Math.max(Number(options?.maxActions ?? 25), 1), 80),
      allowProxyEvents: Boolean(options?.allowProxyEvents)
    },
    status: 'queued',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    result: null,
    error: null
  };
  jobs.set(jobId, job);
  return job;
}


async function analyzeUrl(job) {
  job.status = 'running';
  job.updatedAt = nowIso();

  const browser = await chromium.launch({
    headless: true,
    proxy: { server: PROXY_SERVER }
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  const navChain = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navChain.push(frame.url());
  });

  await page.addInitScript(() => {
    window.__lionEventLog = [];

    const rawAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function patched(type, listener, options) {
      try {
        const targetTag = this.tagName ? this.tagName.toLowerCase() : 'unknown';
        window.__lionEventLog.push({ type, targetTag, ts: Date.now() });
      } catch (_) {
        // ignore
      }
      return rawAdd.call(this, type, listener, options);
    };
  });

  try {
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1400);

    const discovered = await page.evaluate((maxActions) => {
      const buildSelector = (node) => {
        const tag = node.tagName.toLowerCase();
        if (node.id) return `${tag}#${CSS.escape(node.id)}`;
        const cls = (node.className || "").toString().trim().split(/\s+/).filter(Boolean).slice(0, 2);
        if (cls.length) return `${tag}${cls.map((c) => `.${CSS.escape(c)}`).join("")}`;
        return tag;
      };
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };

      const clickable = Array.from(document.querySelectorAll('a[href], button, [role="button"], input[type="submit"], input[type="button"], [aria-haspopup="menu"]'))
        .filter(visible)
        .slice(0, maxActions)
        .map((node) => ({
          type: 'click',
          selector: buildSelector(node),
          tag: node.tagName.toLowerCase(),
          href: node.tagName.toLowerCase() === 'a' ? (node.getAttribute('href') || '') : ''
        }));

      const fillable = Array.from(document.querySelectorAll('input[type="text"], input[type="search"], input[type="email"], textarea'))
        .filter(visible)
        .slice(0, Math.ceil(maxActions / 2))
        .map((node) => ({
          type: 'fill',
          selector: buildSelector(node),
          value: `srv_${Math.random().toString(36).slice(2, 8)}`
        }));

      const eventLog = Array.isArray(window.__lionEventLog) ? window.__lionEventLog.slice(0, 300) : [];
      return { clickable, fillable, eventLog };
    }, job.options.maxActions);

    const executedActions = [];
    const candidates = [...discovered.clickable, ...discovered.fillable].slice(0, job.options.maxActions);

    for (const action of candidates) {
      try {
        if (action.type === 'click') {
          const clicked = await page.evaluate((selector) => {
            const el = document.querySelector(selector);
            if (!el) return false;
            if (el.tagName.toLowerCase() === 'a') {
              const href = el.getAttribute('href') || '';
              if (/^javascript:/i.test(href)) return false;
              el.setAttribute('target', '_blank');
            }
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return true;
          }, action.selector);
          if (clicked) executedActions.push(action);
        }

        if (action.type === 'fill') {
          const filled = await page.evaluate(({ selector, value }) => {
            const el = document.querySelector(selector);
            if (!el) return false;
            el.focus();
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }, action);
          if (filled) executedActions.push(action);
        }
      } catch (_) {
        // keep going
      }
    }

    const proxyEvents = job.options.allowProxyEvents ? consumeProxyEvents(job.url) : [];
    const proxyActions = proxyEvents
      .flatMap((evt) => {
        if (evt.selector) {
          return [{ type: 'click', selector: evt.selector, source: 'proxy' }];
        }
        if (evt.redirectUrl && /^https?:\/\//i.test(evt.redirectUrl)) {
          return [{ type: 'navigate', url: evt.redirectUrl, source: 'proxy' }];
        }
        return [];
      })
      .slice(0, 20);

    job.result = {
      analyzedUrl: job.url,
      discoveredCount: candidates.length,
      executedActions: [...executedActions, ...proxyActions],
      navigationChain: [...new Set(navChain)],
      sampledEvents: discovered.eventLog,
      proxyEvents
    };

    job.status = 'done';
    job.updatedAt = nowIso();
  } catch (error) {
    job.status = 'failed';
    job.error = error.message;
    job.updatedAt = nowIso();
  } finally {
    await context.close();
    await browser.close();
  }
}

app.post('/jobs', (req, res) => {
  const { url, options } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url은 필수 문자열입니다.' });
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return res.status(400).json({ error: '유효한 URL이 아닙니다.' });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'http/https URL만 지원합니다.' });
  }

  const job = createJob(parsed.toString(), options || {});
  analyzeUrl(job).catch((error) => {
    job.status = 'failed';
    job.updatedAt = nowIso();
    job.error = error.message;
  });

  return res.status(202).json({ jobId: job.jobId, status: job.status });
});

app.get('/jobs/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: '작업을 찾을 수 없습니다.' });
  return res.json(job);
});

app.post('/proxy/events', (req, res) => {
  const { url, eventType, selector, redirectUrl, note } = req.body || {};
  if (!url || !eventType) {
    return res.status(400).json({ error: 'url,eventType 필수' });
  }

  pushProxyEvent(url, { eventType, selector, redirectUrl, note });
  return res.json({ ok: true });
});

app.get('/health', (_, res) => {
  res.json({ ok: true, service: 'lion-server', proxy: PROXY_SERVER, time: nowIso() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`lion server listening on http://localhost:${PORT}`);
});
