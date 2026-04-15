/**
 * background.js
 * Service worker for Event Blaster.
 * Uses chrome.scripting.executeScript to execute code in the MAIN world,
 * bypassing Content Security Policy (CSP) against inline scripts.
 */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'EXECUTE_IN_MAIN_WORLD' && sender.tab) {
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: 'MAIN',
      func: deepFrameworkExecute,
      args: [msg.name]
    }).then(results => {
      if (results && results[0]) {
        sendResponse(results[0].result);
      } else {
        sendResponse({ ok: false, error: 'No result from script' });
      }
    }).catch(err => {
      sendResponse({ ok: false, error: err.message });
    });
    
    // 비동기 응답을 위해 true 반환
    return true;
  }
});

/**
 * 이 함수는 직렬화되어 대상 웹페이지의 MAIN world 컨텍스트에서 실행됩니다.
 * 내부 스코프에서 선언된 모든 변수와 로직만 있어야 하며, 외부 의존성이 없어야 합니다.
 */
function deepFrameworkExecute(_name) {
  var ok = false;
  var method = '';
  var err = '';

  try {
    // [A] 전역 공간 탐색
    if (typeof window[_name] === 'function') {
      window[_name]();
      ok = true; method = 'window';
    } else {
      try {
        eval(_name + '()');
        ok = true; method = 'eval';
      } catch(e) {}
    }

    // [B] Webpack 모듈 탈취 (숨겨진 내부 함수 접근)
    if (!ok) {
      var wpKey = Object.keys(window).find(k => k.startsWith('webpackChunk'));
      if (wpKey && window[wpKey]) {
        window[wpKey].push([ [Symbol()], {}, function(__webpack_require__) {
          var modules = __webpack_require__.c || __webpack_require__.m;
          if (modules) {
            for (var id in modules) {
              try {
                var exp = modules[id].exports;
                if (exp && typeof exp[_name] === 'function') {
                  exp[_name]();
                  ok = true; method = 'webpack-module';
                  break;
                }
                if (exp && exp.default && typeof exp.default[_name] === 'function') {
                  exp.default[_name]();
                  ok = true; method = 'webpack-default';
                  break;
                }
              } catch(e2) {}
            }
          }
        }]);
      }
    }

    // [C] React Fiber / Vue Instance 딥스캔
    if (!ok) {
      function searchFrameworks(node) {
        // React Fiber
        var reactKey = Object.keys(node).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactFiber$'));
        if (reactKey && node[reactKey]) {
          var props = node[reactKey];
          for (var p in props) {
            if (typeof props[p] === 'function' && (props[p].name === _name || String(props[p]).includes(_name))) {
              // React 이벤트 객체를 흉내내어 내부 핸들러 강제 호출
              props[p]({ preventDefault:function(){}, stopPropagation:function(){} }); 
              ok = true; method = 'react-fiber';
              return true;
            }
          }
        }
        // Vue
        if (node.__vue__) {
           var v = node.__vue__;
           if (typeof v[_name] === 'function') {
              v[_name]();
              ok = true; method = 'vue-instance';
              return true;
           }
        }
        return false;
      }

      // 트리 재귀 탐색
      function walk(n) {
        if (!n) return false;
        if (searchFrameworks(n)) return true;
        var children = n.children || [];
        for (var i = 0; i < children.length; i++) {
          if (walk(children[i])) return true;
        }
        return false;
      }

      walk(document.body);
    }
  } catch(e) {
    err = e.message || String(e);
  }

  return { ok: ok, method: method, error: err };
}
