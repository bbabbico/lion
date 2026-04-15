/*
 * content.js — Event Blaster 컨텐츠 스크립트
 * 대기 오버레이, BGM 재생, BOOM 연출, 함수 실행
 */

(() => {
  // Prevent duplicate injection
  if (window.__eventBlasterInjected) return;
  window.__eventBlasterInjected = true;

  let overlay = null;
  let audioCtx = null;
  let bgmAudio = null;
  let streamInterval = null;
  let progressInterval = null;
  let timerInterval = null;
  let beepInterval = null;
  let startTime = 0;

  // ──────────────────────────────────────
  // Message listener
  // ──────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.action) {
      case 'START_WAIT':
        showWaitOverlay(msg.url);
        break;
      case 'EXECUTE_FN':
        executeFn(msg.fn);
        break;
      case 'EXECUTE_BATCH':
        executeBatch(msg.fns, msg.url, sendResponse);
        return true; // keep channel open for async response
      case 'CANCEL':
        removeOverlay();
        break;
    }
  });

  // ──────────────────────────────────────
  // Wait Overlay
  // ──────────────────────────────────────
  function showWaitOverlay(url) {
    removeOverlay(); // Clean any existing

    startTime = Date.now();

    // Create shadow DOM container
    const host = document.createElement('div');
    host.id = 'event-blaster-overlay-host';
    host.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:all;';
    const shadow = host.attachShadow({ mode: 'open' });

    // Styles
    const style = document.createElement('style');
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Bangers&family=VT323&display=swap');

      * { margin:0; padding:0; box-sizing:border-box; }

      .overlay {
        position: fixed;
        top: 0; left: 0;
        width: 100vw; height: 100vh;
        background: #0a0a1a;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 24px;
        overflow: hidden;
      }

      /* Star dots */
      .overlay::before {
        content: '';
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        background-image:
          radial-gradient(1px 1px at 10% 20%, #fff 50%, transparent 100%),
          radial-gradient(1px 1px at 30% 60%, #fff 50%, transparent 100%),
          radial-gradient(1px 1px at 50% 10%, #fff 50%, transparent 100%),
          radial-gradient(1px 1px at 70% 80%, #fff 50%, transparent 100%),
          radial-gradient(1px 1px at 90% 40%, #fff 50%, transparent 100%),
          radial-gradient(2px 2px at 15% 85%, #ff0 50%, transparent 100%),
          radial-gradient(1px 1px at 45% 45%, #fff 50%, transparent 100%),
          radial-gradient(2px 2px at 85% 15%, #0ff 50%, transparent 100%),
          radial-gradient(1px 1px at 60% 70%, #fff 50%, transparent 100%),
          radial-gradient(1px 1px at 25% 35%, #fff 50%, transparent 100%);
        opacity: 0.6;
        animation: twinkle 4s ease-in-out infinite alternate;
      }

      @keyframes twinkle {
        0% { opacity: 0.4; }
        100% { opacity: 0.8; }
      }

      /* CRT scanlines */
      .overlay::after {
        content: '';
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        background: repeating-linear-gradient(
          0deg,
          rgba(0,0,0,0.2) 0px,
          rgba(0,0,0,0.2) 1px,
          transparent 1px,
          transparent 4px
        );
        pointer-events: none;
      }

      .glitch-title {
        font-family: 'Bangers', Impact, sans-serif;
        font-size: 64px;
        color: #ff0;
        text-transform: uppercase;
        text-shadow:
          4px 4px 0 #f00,
          -2px -2px 0 #0ff,
          0 0 30px rgba(255,255,0,0.5);
        animation: glitch 2s infinite;
        z-index: 2;
        text-align: center;
        letter-spacing: 6px;
      }

      @keyframes glitch {
        0%, 85%, 100% { transform: translate(0); text-shadow: 4px 4px 0 #f00, -2px -2px 0 #0ff; }
        86% { transform: translate(-5px, 2px) skewX(-2deg); text-shadow: 6px 0 0 #f0f, -4px 0 0 #0f0; }
        88% { transform: translate(5px, -2px) skewX(2deg); text-shadow: -6px 0 0 #0ff, 4px 0 0 #f00; }
        90% { transform: translate(-2px, 3px); text-shadow: 4px 4px 0 #f00, -2px -2px 0 #0ff; }
      }

      .stream-box {
        width: 80%;
        max-width: 600px;
        height: 120px;
        background: rgba(0,0,0,0.8);
        border: 3px solid #0f0;
        border-radius: 4px;
        overflow: hidden;
        padding: 12px;
        font-family: 'VT323', 'Courier New', monospace;
        font-size: 16px;
        color: #0f0;
        z-index: 2;
        display: flex;
        flex-direction: column;
        gap: 4px;
        box-shadow: 0 0 20px rgba(0,255,0,0.3), inset 0 0 20px rgba(0,255,0,0.1);
      }

      .stream-line {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        opacity: 0.8;
        transition: opacity 0.1s;
      }

      .stream-line:last-child {
        color: #ff0;
        opacity: 1;
      }

      .progress-container {
        width: 80%;
        max-width: 600px;
        z-index: 2;
      }

      .progress-label {
        font-family: 'VT323', monospace;
        font-size: 18px;
        color: #fff;
        margin-bottom: 4px;
        text-align: center;
      }

      .progress-bar {
        font-family: 'Courier New', monospace;
        font-size: 20px;
        color: #0f0;
        text-align: left;
        letter-spacing: 2px;
        animation: progressColor 3s infinite;
        text-shadow: 0 0 10px currentColor;
      }

      @keyframes progressColor {
        0%, 100% { color: #0f0; }
        33% { color: #ff0; }
        66% { color: #f0f; }
      }

      .timer {
        font-family: 'VT323', monospace;
        font-size: 24px;
        color: #f0f;
        z-index: 2;
        animation: timerBlink 1s steps(1) infinite;
        text-shadow: 0 0 10px rgba(255,0,255,0.5);
      }

      @keyframes timerBlink {
        0%, 70% { opacity: 1; }
        71%, 100% { opacity: 0.3; }
      }

      /* BOOM */
      .boom-flash {
        position: fixed;
        top: 0; left: 0;
        width: 100vw; height: 100vh;
        background: #fff;
        z-index: 10;
        animation: flash 0.15s ease-out forwards;
      }

      @keyframes flash {
        0% { opacity: 1; }
        100% { opacity: 0; }
      }

      .boom-content {
        position: fixed;
        top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        z-index: 11;
        text-align: center;
        animation: boomIn 0.5s cubic-bezier(0.17, 0.67, 0.42, 1.4);
      }

      @keyframes boomIn {
        0% { transform: translate(-50%, -50%) scale(0); opacity: 0; }
        60% { transform: translate(-50%, -50%) scale(1.3); }
        100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
      }

      .boom-emoji {
        font-size: 120px;
        animation: bounce 0.4s ease-in-out 3;
      }

      @keyframes bounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-20px); }
      }

      .boom-fn-name {
        font-family: 'Bangers', Impact, sans-serif;
        font-size: 36px;
        color: #ff0;
        text-shadow: 3px 3px 0 #f00, 0 0 20px rgba(255,255,0,0.8);
        margin-top: 12px;
        text-transform: uppercase;
      }

      .boom-label {
        font-family: 'VT323', monospace;
        font-size: 18px;
        color: #0ff;
        margin-top: 8px;
      }

      .fade-out {
        animation: fadeOut 1s ease-out forwards;
      }

      @keyframes fadeOut {
        0% { opacity: 1; }
        100% { opacity: 0; }
      }
    `;
    shadow.appendChild(style);

    // Overlay container
    const ov = document.createElement('div');
    ov.className = 'overlay';

    // Title
    const title = document.createElement('div');
    title.className = 'glitch-title';
    title.textContent = '💣 SCANNING... 💣';
    ov.appendChild(title);

    // Stream box
    const streamBox = document.createElement('div');
    streamBox.className = 'stream-box';
    for (let i = 0; i < 5; i++) {
      const line = document.createElement('div');
      line.className = 'stream-line';
      line.textContent = '> initializing...';
      streamBox.appendChild(line);
    }
    ov.appendChild(streamBox);

    // Progress bar
    const progressContainer = document.createElement('div');
    progressContainer.className = 'progress-container';
    const progressLabel = document.createElement('div');
    progressLabel.className = 'progress-label';
    progressLabel.textContent = '[ ANALYZING TARGET ]';
    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';
    progressBar.textContent = '';
    progressContainer.appendChild(progressLabel);
    progressContainer.appendChild(progressBar);
    ov.appendChild(progressContainer);

    // Timer
    const timerEl = document.createElement('div');
    timerEl.className = 'timer';
    timerEl.textContent = 'ELAPSED: 0.0s';
    ov.appendChild(timerEl);

    shadow.appendChild(ov);
    document.body.appendChild(host);
    overlay = host;

    // ── Start BGM ──
    try {
      const bgmUrl = chrome.runtime.getURL('assets/bgm.mp3');
      bgmAudio = new Audio(bgmUrl);
      bgmAudio.loop = true;
      bgmAudio.volume = 0.5;
      bgmAudio.play().catch(() => { });
    } catch (e) {
      console.log('BGM not available, continuing without music.');
    }

    // ── Initialize AudioContext for beeps ──
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { }

    // ── Stream animation ──
    const links = extractPageLinks();
    let streamIndex = 0;
    streamInterval = setInterval(() => {
      const lines = streamBox.querySelectorAll('.stream-line');
      const text = links.length > 0
        ? links[streamIndex % links.length]
        : `> scanning_sector_${Math.floor(Math.random() * 999)}...`;

      // Shift lines up
      for (let i = 0; i < lines.length - 1; i++) {
        lines[i].textContent = lines[i + 1].textContent;
      }
      lines[lines.length - 1].textContent = `> ${text}`;
      streamIndex++;
    }, 150);

    // ── Progress bar ──
    let progressCount = 0;
    progressInterval = setInterval(() => {
      progressCount = (progressCount + 1) % 31;
      const filled = '█'.repeat(progressCount);
      const empty = '░'.repeat(30 - progressCount);
      progressBar.textContent = `[${filled}${empty}]`;
    }, 200);

    // ── Timer ──
    timerInterval = setInterval(() => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      timerEl.textContent = `ELAPSED: ${elapsed}s`;
    }, 100);

    // ── 3-second beep ──
    beepInterval = setInterval(() => {
      playBeep();
    }, 3000);
  }

  // ────────────────────�  // ──────────────────────────────────────
  // Batch Execute
  // ──────────────────────────────────────
  async function executeBatch(fns, url, sendResponse) {
    // Stop BGM & overlay immediately
    stopBGM();
    clearAllIntervals();
    playBoomSound();
    showBoomAnimation(`${fns.length} FUNCTIONS`, () => {
      removeOverlay();
    });

    const successes = [];
    const failures = [];

    for (const fn of fns) {
      const result = await actuallyExecute(fn.name);
      if (result.ok) {
        successes.push({ name: fn.name, method: result.method });
      } else {
        failures.push({ name: fn.name, error: result.error });
      }
      // 짧은 딜레이로 DOM 반응 시간 확보
      await new Promise(r => setTimeout(r, 80));
    }

    console.log(`[Event Blaster] Batch done: ${successes.length} ok, ${failures.length} failed`);
    sendResponse({ successes, failures });
  }

  /**
   * 페이지의 컨텍스트에서 함수 실행을 시도합니다.
   * 단순히 버튼을 클릭하는 것을 넘어, Webpack 모듈, React/Vue 컴포넌트 내부에 숨겨진
   * 비공개(private) 함수나 권한 제한 함수를 강제로 찾아내(invoke) 실행합니다.
   */
  function actuallyExecute(name) {
    return new Promise((resolve) => {
      let ok = false;
      let method = '';
      let err = '';

      const done = (isOk, m, errorStr) => {
        if (!ok) {
          ok = isOk;
          method = m;
          err = errorStr || '';
          resolve({ ok, method, error: err });
        }
      };

      // 3. Main World 스크립트 실행 (CSP 우회를 위해 background.js로 위임)
      const timeout = setTimeout(() => {
        fallbackDomTrigger();
      }, 1000); // 1000ms 대기

      function fallbackDomTrigger() {
        if (ok) return;
        try {
          // 명시적으로 해당 이름이 바인딩된 DOM만 트리거
          const exactEls = document.querySelectorAll(`[id="${name}"], [name="${name}"], [data-action="${name}"]`);
          if (exactEls.length > 0) {
            exactEls[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            return done(true, 'dom-exact-match');
          }
        } catch (e) {}
        done(false, '', 'not found in window, webpack, react, vue, or dom');
      }

      try {
        chrome.runtime.sendMessage({ action: 'EXECUTE_IN_MAIN_WORLD', name: name }, (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError || !response) {
            fallbackDomTrigger();
            return;
          }
          
          if (response.ok) {
            done(true, response.method);
          } else {
            fallbackDomTrigger();
          }
        });
      } catch (e) {
        clearTimeout(timeout);
        fallbackDomTrigger();
      }
    });
  }

  // ──────────────────────────────────────
  // BOOM Animation
  // ──────────────────────────────────────
  function showBoomAnimation(fnName, onComplete) {
    if (!overlay) {
      onComplete && onComplete();
      return;
    }

    const shadow = overlay.shadowRoot;
    const existingOverlay = shadow.querySelector('.overlay');

    // White flash
    const flash = document.createElement('div');
    flash.className = 'boom-flash';
    shadow.appendChild(flash);

    // After flash, show BOOM
    setTimeout(() => {
      if (existingOverlay) existingOverlay.style.display = 'none';

      const boomContent = document.createElement('div');
      boomContent.className = 'boom-content';
      boomContent.innerHTML = `
        <div class="boom-emoji">💥</div>
        <div class="boom-fn-name">${escapeHtml(fnName)}()</div>
        <div class="boom-label">— FUNCTION EXECUTED —</div>
      `;
      shadow.appendChild(boomContent);

      // Fade out after 1.5s
      setTimeout(() => {
        boomContent.classList.add('fade-out');
        setTimeout(() => {
          onComplete && onComplete();
        }, 1000);
      }, 1500);
    }, 150);
  }

  // ──────────────────────────────────────
  // Audio
  // ──────────────────────────────────────
  function playBeep() {
    if (!audioCtx) return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = 800;
      osc.type = 'square';
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.15);
    } catch (e) { }
  }

  function playBoomSound() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) { return; }
    }

    const now = audioCtx.currentTime;

    // Layer 1: Low punch
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.frequency.setValueAtTime(80, now);
    osc1.frequency.exponentialRampToValueAtTime(20, now + 0.5);
    osc1.type = 'sine';
    gain1.gain.setValueAtTime(0.8, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc1.start(now);
    osc1.stop(now + 0.5);

    // Layer 2: Noise burst
    const bufferSize = audioCtx.sampleRate * 0.3;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.1));
    }
    const noise = audioCtx.createBufferSource();
    const noiseGain = audioCtx.createGain();
    noise.buffer = noiseBuffer;
    noise.connect(noiseGain);
    noiseGain.connect(audioCtx.destination);
    noiseGain.gain.setValueAtTime(0.5, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    noise.start(now);

    // Layer 3: High squeak
    const osc3 = audioCtx.createOscillator();
    const gain3 = audioCtx.createGain();
    osc3.connect(gain3);
    gain3.connect(audioCtx.destination);
    osc3.frequency.setValueAtTime(2000, now);
    osc3.frequency.exponentialRampToValueAtTime(200, now + 0.2);
    osc3.type = 'sawtooth';
    gain3.gain.setValueAtTime(0.3, now);
    gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc3.start(now);
    osc3.stop(now + 0.2);
  }

  function stopBGM() {
    if (bgmAudio) {
      bgmAudio.pause();
      bgmAudio.currentTime = 0;
      bgmAudio = null;
    }
  }

  // ──────────────────────────────────────
  // Cleanup
  // ──────────────────────────────────────
  function removeOverlay() {
    stopBGM();
    clearAllIntervals();
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    if (audioCtx) {
      audioCtx.close().catch(() => { });
      audioCtx = null;
    }
  }

  function clearAllIntervals() {
    if (streamInterval) { clearInterval(streamInterval); streamInterval = null; }
    if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (beepInterval) { clearInterval(beepInterval); beepInterval = null; }
  }

  // ──────────────────────────────────────
  // Utilities
  // ──────────────────────────────────────
  function extractPageLinks() {
    const links = [];
    try {
      document.querySelectorAll('a[href], link[href], script[src], img[src]').forEach(el => {
        const val = el.getAttribute('href') || el.getAttribute('src');
        if (val && !val.startsWith('data:') && !val.startsWith('javascript:')) {
          links.push(val);
        }
      });
    } catch (e) { }
    if (links.length === 0) {
      links.push('/index.html', '/app.js', '/style.css', '/api/data', '/assets/logo.png');
    }
    return links;
  }

  function escapeHtml(text) {
    const div = document.createElement('span');
    div.textContent = text;
    return div.innerHTML;
  }
})();
