const express = require('express');
const crypto = require('crypto');
const { chromium } = require('playwright');

const app = express();
app.use(express.json());

const jobs = new Map();

function nowIso() {
  return new Date().toISOString();
}

function createJob(url, options) {
  const jobId = crypto.randomUUID();
  const job = {
    jobId,
    url,
    options: {
      maxActions: Math.min(Math.max(options?.maxActions ?? 20, 1), 50)
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

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const navigations = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      navigations.push(frame.url());
    }
  });

  await page.addInitScript(() => {
    window.__lionEventLog = [];

    const rawAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function patched(type, listener, options) {
      try {
        const tag = this.tagName ? this.tagName.toLowerCase() : 'unknown';
        window.__lionEventLog.push({ type, tag });
      } catch (_) {
        // ignore logging error
      }
      return rawAdd.call(this, type, listener, options);
    };
  });

  try {
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);

    const discovered = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('a[href], button, input[type="submit"], input[type="button"]'));

      const visible = nodes.filter((node) => {
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      });

      const normalized = visible.slice(0, 120).map((node) => {
        const tag = node.tagName.toLowerCase();
        const idPart = node.id ? `#${CSS.escape(node.id)}` : '';
        const href = tag === 'a' ? node.getAttribute('href') || '' : '';
        const name = node.getAttribute('name') || '';
        const className = (node.className || '').toString().trim().split(/\s+/).slice(0, 2).map((c) => `.${CSS.escape(c)}`).join('');
        const selector = idPart ? `${tag}${idPart}` : `${tag}${className}`;

        return {
          selector,
          tag,
          href,
          name,
          text: (node.textContent || '').trim().slice(0, 80)
        };
      });

      const eventLog = Array.isArray(window.__lionEventLog) ? window.__lionEventLog.slice(0, 250) : [];
      return { normalized, eventLog };
    });

    const safeCandidates = discovered.normalized.filter((item) => {
      if (!item.selector) return false;
      if (item.tag === 'a') {
        return !/^javascript:/i.test(item.href);
      }
      return item.tag === 'button' || item.tag === 'input';
    });

    const executedActions = [];
    const maxActions = Math.min(job.options.maxActions, safeCandidates.length);

    for (let i = 0; i < maxActions; i += 1) {
      const target = safeCandidates[i];
      try {
        const clicked = await page.evaluate((selector) => {
          const el = document.querySelector(selector);
          if (!el) return false;

          if (el.tagName.toLowerCase() === 'a') {
            el.setAttribute('target', '_blank');
          }

          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return true;
        }, target.selector);

        if (clicked) {
          executedActions.push({
            selector: target.selector,
            type: 'click',
            tag: target.tag
          });
        }
      } catch (_) {
        // keep running on individual action errors
      }
    }

    job.result = {
      analyzedUrl: job.url,
      navigationChain: [...new Set(navigations)],
      discoveredCount: safeCandidates.length,
      executedActions,
      sampledEvents: discovered.eventLog
    };

    job.status = 'done';
    job.updatedAt = nowIso();
  } catch (error) {
    job.status = 'failed';
    job.updatedAt = nowIso();
    job.error = error.message;
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

  const job = createJob(parsed.toString(), options);
  analyzeUrl(job).catch((error) => {
    job.status = 'failed';
    job.updatedAt = nowIso();
    job.error = error.message;
  });

  return res.status(202).json({
    jobId: job.jobId,
    status: job.status
  });
});

app.get('/jobs/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: '작업을 찾을 수 없습니다.' });
  }

  return res.json({
    jobId: job.jobId,
    url: job.url,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    result: job.result,
    error: job.error
  });
});

app.get('/health', (_, res) => {
  res.json({ ok: true, service: 'lion-server', time: nowIso() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`lion server listening on http://localhost:${PORT}`);
});
