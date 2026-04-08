let socket = null;

// 소켓을 연결하고 Promise로 반환하는 헬퍼 함수
function connectWebSocket() {
  return new Promise((resolve) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    
    socket = new WebSocket('ws://localhost:3000');
    
    socket.onopen = () => {
      console.log('✅ [Extension] WebSocket 연결 성공');
      resolve();
    };
    
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.action === 'TRIGGER_RANDOM_CLICK') {
        console.log('⚡ [Extension] 백엔드 신호 수신! 랜덤 클릭을 실행합니다.');
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
          if(tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: 'EXECUTE_RANDOM' });
        });
      }
    };
  });
}

// 팝업창에서 보내는 '분석 시작' 명령 대기
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'START_ANALYSIS') {
    connectWebSocket().then(() => {
      // 서버 연결이 완료되면 서버에게 현재 웹페이지 주소를 던지며 접속하라고 명령
      socket.send(JSON.stringify({ 
        action: 'START_BACKEND_FETCH', 
        url: message.url 
      }));
    });
  }
});