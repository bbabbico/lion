/**
 * Event Blaster — Backend Server
 * 
 * URL 수신 → 프록시 경유 접속 → HTML/JS/JSX/XML 파싱 → 함수/이벤트 추출 → 목록 반환
 * 서버 로그 기능 포함
 */

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// ──────────────────────────────────────
// Middleware
// ──────────────────────────────────────
app.use(cors());
app.use(express.json());

// ──────────────────────────────────────
// Logging System
// ──────────────────────────────────────
const LOG_FILE = path.join(__dirname, 'server-log.json');

function loadLogs() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      return JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
    }
  } catch (e) { }
  return [];
}

function saveLogs(logs) {
  // Keep last 500 entries
  const trimmed = logs.slice(-500);
  fs.writeFileSync(LOG_FILE, JSON.stringify(trimmed, null, 2), 'utf-8');
}

function addLog(entry) {
  const logs = loadLogs();
  const logEntry = {
    timestamp: new Date().toISOString(),
    ...entry
  };
  logs.push(logEntry);
  saveLogs(logs);

  // Console output
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📋 [LOG] ${logEntry.timestamp}`);
  if (logEntry.url) console.log(`   🌐 URL: ${logEntry.url}`);
  if (logEntry.action) console.log(`   📌 Action: ${logEntry.action}`);
  if (logEntry.functionsCount !== undefined) console.log(`   📊 Functions Found: ${logEntry.functionsCount}`);
  if (logEntry.functions) {
    logEntry.functions.forEach((fn, i) => {
      console.log(`   ${i + 1}. ${fn.name} (${fn.type}) — ${fn.source}`);
    });
  }
  if (logEntry.error) console.log(`   ❌ Error: ${logEntry.error}`);
  console.log(`${'═'.repeat(60)}`);

  return logEntry;
}

// ──────────────────────────────────────
// API Routes
// ──────────────────────────────────────

/**
 * POST /api/parse
 * URL을 받아서 프록시 경유로 사이트 소스를 수집하고
 * 함수/이벤트 목록을 추출하여 반환
 */
app.post('/api/parse', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    addLog({ action: 'PARSE_REQUEST', error: 'No URL provided' });
    return res.status(400).json({ error: 'URL is required' });
  }

  console.log(`\n🚀 Incoming parse request for: ${url}`);
  addLog({ action: 'PARSE_REQUEST_RECEIVED', url });

  try {
    // Step 1: Fetch HTML via proxy
    const htmlContent = await fetchWithProxy(url);

    if (!htmlContent) {
      addLog({ action: 'FETCH_FAILED', url, error: 'Empty response from target' });
      return res.status(502).json({ error: 'Failed to fetch target page' });
    }

    addLog({ action: 'HTML_FETCHED', url, contentLength: htmlContent.length });

    // Step 2: Parse HTML and extract linked scripts
    const $ = cheerio.load(htmlContent);
    const baseUrl = new URL(url);

    // Collect all script sources
    const scriptUrls = [];
    $('script[src]').each((i, el) => {
      const src = $(el).attr('src');
      if (src) {
        try {
          const absoluteUrl = new URL(src, baseUrl).href;
          scriptUrls.push(absoluteUrl);
        } catch (e) { }
      }
    });

    addLog({ action: 'SCRIPTS_FOUND', url, scriptCount: scriptUrls.length, scripts: scriptUrls.slice(0, 20) });

    // Step 3: Fetch all linked scripts
    const scriptContents = [];
    for (const scriptUrl of scriptUrls.slice(0, 20)) { // Limit to 20 scripts
      try {
        const scriptContent = await fetchWithProxy(scriptUrl);
        if (scriptContent) {
          scriptContents.push({ url: scriptUrl, content: scriptContent });
        }
      } catch (e) {
        console.log(`   ⚠ Failed to fetch script: ${scriptUrl}`);
      }
    }

    // Step 4: Extract inline scripts
    const inlineScripts = [];
    $('script:not([src])').each((i, el) => {
      const content = $(el).html();
      if (content && content.trim().length > 0) {
        inlineScripts.push(content);
      }
    });

    // Step 5: Parse all sources for functions/events
    let allFunctions = [];

    // Parse HTML for events
    const htmlFunctions = parseHTMLForEvents($, 'index.html');
    allFunctions.push(...htmlFunctions);

    // Parse inline scripts
    inlineScripts.forEach((script, i) => {
      const fns = parseJSForFunctions(script, `inline-script-${i + 1}`);
      allFunctions.push(...fns);
    });

    // Parse external scripts
    scriptContents.forEach(({ url: sUrl, content }) => {
      const filename = extractFilename(sUrl);
      const fns = parseJSForFunctions(content, filename);
      allFunctions.push(...fns);
    });

    // Step 6: Filter
    allFunctions = filterFunctions(allFunctions);

    // Step 7: Deduplicate
    const seen = new Set();
    allFunctions = allFunctions.filter(fn => {
      const key = `${fn.name}:${fn.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Log the results
    addLog({
      action: 'PARSE_COMPLETE',
      url,
      functionsCount: allFunctions.length,
      functions: allFunctions
    });

    // Step 8: Return response
    const response = {
      url,
      functions: allFunctions
    };

    console.log(`\n✅ Returning ${allFunctions.length} functions for ${url}`);
    res.json(response);

  } catch (err) {
    console.error('Parse error:', err);
    addLog({ action: 'PARSE_ERROR', url, error: err.message });
    res.status(500).json({ error: `Parse failed: ${err.message}` });
  }
});

/**
 * GET /api/logs
 * 서버 로그 조회
 */
app.get('/api/logs', (req, res) => {
  const logs = loadLogs();
  const limit = parseInt(req.query.limit) || 50;
  res.json({
    total: logs.length,
    logs: logs.slice(-limit)
  });
});

/**
 * DELETE /api/logs
 * 서버 로그 삭제
 */
app.delete('/api/logs', (req, res) => {
  saveLogs([]);
  console.log('🗑 Server logs cleared');
  res.json({ message: 'Logs cleared' });
});

// ──────────────────────────────────────
// Proxy Fetch
// ──────────────────────────────────────
async function fetchWithProxy(targetUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'identity',
      },
      redirect: 'follow',
    });

    clearTimeout(timeout);
    return await response.text();
  } catch (err) {
    clearTimeout(timeout);
    throw new Error(`Proxy fetch failed for ${targetUrl}: ${err.message}`);
  }
}

// ──────────────────────────────────────
// Parsers
// ──────────────────────────────────────

/**
 * Parse HTML for event handlers
 */
function parseHTMLForEvents($, source) {
  const events = [];

  // onclick="foo()" and similar event attributes
  const eventAttrs = [
    'onclick', 'onsubmit', 'onchange', 'oninput', 'onload',
    'onmouseover', 'onmouseout', 'onkeydown', 'onkeyup',
    'onfocus', 'onblur', 'ondblclick', 'onscroll', 'onresize'
  ];

  eventAttrs.forEach(attr => {
    $(`[${attr}]`).each((i, el) => {
      const value = $(el).attr(attr);
      if (value) {
        // Extract function name from handler
        const fnMatch = value.match(/(\w+)\s*\(/);
        if (fnMatch && fnMatch[1]) {
          events.push({
            name: fnMatch[1],
            type: 'event',
            source
          });
        }
      }
    });
  });

  // data-action="foo"
  $('[data-action]').each((i, el) => {
    const action = $(el).attr('data-action');
    if (action && action.length > 2) {
      events.push({
        name: action,
        type: 'event',
        source
      });
    }
  });

  // addEventListener('event', handler) in inline scripts (basic detection from HTML attributes)
  $('*').each((i, el) => {
    const attrs = el.attribs || {};
    Object.values(attrs).forEach(val => {
      const listenerMatch = val.match(/addEventListener\s*\(\s*['"](\w+)['"]\s*,\s*(\w+)/g);
      if (listenerMatch) {
        listenerMatch.forEach(m => {
          const parts = m.match(/addEventListener\s*\(\s*['"](\w+)['"]\s*,\s*(\w+)/);
          if (parts && parts[2]) {
            events.push({
              name: parts[2],
              type: 'event',
              source
            });
          }
        });
      }
    });
  });

  return events;
}

/**
 * Parse JS/JSX source for functions
 */
function parseJSForFunctions(source, filename) {
  const functions = [];

  // Pattern 1: function foo()
  const fnDecl = /function\s+([a-zA-Z_$][\w$]*)\s*\(/g;
  let match;
  while ((match = fnDecl.exec(source)) !== null) {
    functions.push({ name: match[1], type: 'function', source: filename });
  }

  // Pattern 2: const/let/var foo = () =>
  const arrowFn = /(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>/g;
  while ((match = arrowFn.exec(source)) !== null) {
    functions.push({ name: match[1], type: 'function', source: filename });
  }

  // Pattern 3: const/let/var foo = function(
  const fnExpr = /(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*function\s*\(/g;
  while ((match = fnExpr.exec(source)) !== null) {
    functions.push({ name: match[1], type: 'function', source: filename });
  }

  // Pattern 4: foo: function(  (object method)
  const objMethod = /([a-zA-Z_$][\w$]*)\s*:\s*function\s*\(/g;
  while ((match = objMethod.exec(source)) !== null) {
    functions.push({ name: match[1], type: 'function', source: filename });
  }

  // Pattern 5: window.foo = function / window.foo = () =>
  const windowFn = /window\.([a-zA-Z_$][\w$]*)\s*=\s*(?:function|\([^)]*\)\s*=>|[a-zA-Z_$][\w$]*\s*=>)/g;
  while ((match = windowFn.exec(source)) !== null) {
    functions.push({ name: match[1], type: 'function', source: filename });
  }

  // Pattern 6: addEventListener('event', handler)
  const addEventListener = /addEventListener\s*\(\s*['"]([\w]+)['"]\s*,\s*([a-zA-Z_$][\w$]*)/g;
  while ((match = addEventListener.exec(source)) !== null) {
    functions.push({ name: match[2], type: 'event', source: filename });
  }

  // Pattern 7: export function foo()
  const exportFn = /export\s+(?:default\s+)?function\s+([a-zA-Z_$][\w$]*)/g;
  while ((match = exportFn.exec(source)) !== null) {
    functions.push({ name: match[1], type: 'function', source: filename });
  }

  // Pattern 8: export const foo = () =>
  const exportArrow = /export\s+(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>/g;
  while ((match = exportArrow.exec(source)) !== null) {
    functions.push({ name: match[1], type: 'function', source: filename });
  }

  // Pattern 9: class Method — foo() { or async foo() {
  const classMethod = /^\s+(?:async\s+)?([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*\{/gm;
  while ((match = classMethod.exec(source)) !== null) {
    const name = match[1];
    // Exclude common non-function patterns
    if (!['if', 'for', 'while', 'switch', 'catch', 'constructor', 'return'].includes(name)) {
      functions.push({ name, type: 'function', source: filename });
    }
  }

  return functions;
}

// ──────────────────────────────────────
// Filters
// ──────────────────────────────────────

/**
 * Filter out anonymous, minified, and library-internal functions
 */
function filterFunctions(functions) {
  // Blacklist of common library/internal function names
  const blacklist = new Set([
    'anonymous', 'undefined', 'null', 'true', 'false',
    'require', 'define', 'module', 'exports',
    '__webpack_require__', '__webpack_modules__',
    'webpackJsonp', 'webpackChunk',
    '_interopRequireDefault', '_interopRequireWildcard',
    '_classCallCheck', '_createClass', '_possibleConstructorReturn',
    '_inherits', '_extends', '_objectSpread',
    '_typeof', '_slicedToArray', '_toConsumableArray',
    '_asyncToGenerator', '_regeneratorRuntime',
    'createElement', 'createContext', 'useState', 'useEffect',
    'useCallback', 'useMemo', 'useRef', 'useReducer',
    'render', 'hydrate', 'createRoot',
    'Object', 'Array', 'String', 'Number', 'Boolean',
    'Math', 'Date', 'RegExp', 'Error', 'Promise',
    'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite',
    'encodeURIComponent', 'decodeURIComponent',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'console', 'alert', 'confirm', 'prompt',
    'get', 'set', 'has', 'delete', 'keys', 'values', 'entries',
    'forEach', 'map', 'filter', 'reduce', 'find', 'some', 'every',
    'push', 'pop', 'shift', 'unshift', 'splice', 'slice',
    'toString', 'valueOf', 'hasOwnProperty',
    'addEventListener', 'removeEventListener',
    'querySelector', 'querySelectorAll', 'getElementById',
    'appendChild', 'removeChild', 'insertBefore',
    'dispatch', 'subscribe', 'getState',
  ]);

  return functions.filter(fn => {
    const name = fn.name;

    // Remove 1-2 character minified names
    if (name.length <= 2) return false;

    // Remove names starting with underscore (private/internal)
    if (name.startsWith('_') && name.length < 10) return false;

    // Remove blacklisted names
    if (blacklist.has(name)) return false;

    // Remove names that look minified (single letter + numbers)
    if (/^[a-z]\d+$/i.test(name)) return false;

    // Remove names with $ prefix (framework internal)
    if (name.startsWith('$') || name.startsWith('$$')) return false;

    return true;
  });
}

// ──────────────────────────────────────
// Utilities
// ──────────────────────────────────────
function extractFilename(urlStr) {
  try {
    const parsed = new URL(urlStr);
    const pathname = parsed.pathname;
    const parts = pathname.split('/');
    return parts[parts.length - 1] || 'unknown.js';
  } catch (e) {
    return 'unknown.js';
  }
}

// ──────────────────────────────────────
// Start Server
// ──────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║         💥 EVENT BLASTER BACKEND 💥              ║
║                                                  ║
║   Server running on http://localhost:${PORT}       ║
║   POST /api/parse   — Parse a URL                ║
║   GET  /api/logs    — View server logs           ║
║   DELETE /api/logs  — Clear server logs           ║
║                                                  ║
╚══════════════════════════════════════════════════╝
  `);

  addLog({ action: 'SERVER_STARTED', port: PORT });
});
