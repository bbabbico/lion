const BURST_COUNT = 6; // 🔥 처음에 한 번에 띄울 이벤트 개수

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 팝업에서 "초기 난사 시작!" 신호가 왔을 때
  if (request.action === 'START_BURST') {
    console.log(`👀 [Content] 명령 수신! 처음에 ${BURST_COUNT}개의 이벤트를 연속으로 발생시키고 응답을 대기합니다.`);
    fireBurst();
  }
  
  // 백엔드/프록시에서 "찾았어!" 신호가 왔을 때
  if (request.action === 'EXECUTE_RANDOM') {
    console.log('🔵 [Content] 프록시 감지 신호 수신! 서버 응답에 따른 최종 이벤트를 실행합니다.');
    
    // 최종 실행일 때는 true를 넘겨 파란색 테두리가 나오게 합니다.
    triggerRandomEvent(true); 
  }
});

// 초기 6연발을 쏘는 함수
function fireBurst() {
  // 6개를 0초에 동시에 쏘면 브라우저가 과부하로 무시할 수 있으므로, 
  // 0.2초(200ms) 간격으로 따다닥! 쏘도록 시차를 둡니다.
  for (let i = 0; i < BURST_COUNT; i++) {
    setTimeout(() => {
      console.log(`🔴 [Burst Mode] ${i + 1}번째 이벤트 발사!`);
      triggerRandomEvent(false);
    }, i * 200);
  }
}

// 요소 수집 및 클릭 함수 (isFinal 변수로 최종 클릭인지 구분)
function triggerRandomEvent(isFinal = false) {
  const selectors = 'a[href], button, [role="button"], input[type="submit"], input[type="button"]';
  const allElements = Array.from(document.querySelectorAll(selectors));

  const visibleElements = allElements.filter(el => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  });

  if (visibleElements.length === 0) {
    console.log('⚠️ 클릭할 요소가 없습니다.');
    return;
  }

  const randomIndex = Math.floor(Math.random() * visibleElements.length);
  const targetElement = visibleElements[randomIndex];
  
  // 페이지 증발(리디렉션) 방지를 위한 새 탭 강제 열기
  if (targetElement.tagName.toLowerCase() === 'a') {
    targetElement.target = '_blank';
  } else {
    const parentForm = targetElement.closest('form');
    if (parentForm) parentForm.target = '_blank';
  }

  // 시각적 피드백
  const originalOutline = targetElement.style.outline;
  const originalTransition = targetElement.style.transition;
  targetElement.style.transition = 'all 0.3s';
  
  // 🔥 구별 포인트: 처음 6방은 얇은 빨간색, 최종 서버 응답은 두꺼운 파란색!
  if (isFinal) {
    targetElement.style.outline = '6px solid blue';
  } else {
    targetElement.style.outline = '3px solid red';
  }
  targetElement.style.outlineOffset = '2px';

  // 클릭 실행
  setTimeout(() => {
    targetElement.style.outline = originalOutline;
    targetElement.style.transition = originalTransition;
    targetElement.click();
  }, 150);
}