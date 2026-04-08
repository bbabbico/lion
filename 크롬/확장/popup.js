document.getElementById('connectBtn').addEventListener('click', async () => {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // 1. 백그라운드(서버)에 타겟 URL 접속 및 분석 지시
  chrome.runtime.sendMessage({ action: 'START_ANALYSIS', url: tab.url });

  // 2. 현재 웹페이지(content.js)에 "기다리는 동안 막 눌러!" 지시
  chrome.tabs.sendMessage(tab.id, { action: 'START_HUNTING' });
  
  const btn = document.getElementById('connectBtn');
  btn.innerText = "대기 중 난사 모드 가동! 🔫";
  btn.style.background = "#ff9800";
});