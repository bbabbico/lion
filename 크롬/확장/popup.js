const runBtn = document.getElementById('runBtn');
const statusEl = document.getElementById('status');

runBtn.addEventListener('click', async () => {
  runBtn.disabled = true;
  statusEl.textContent = '작업 요청 중...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id || !tab?.url) {
      throw new Error('활성 탭 URL을 찾지 못했습니다.');
    }

    const response = await chrome.runtime.sendMessage({
      action: 'START_ANALYSIS',
      payload: {
        url: tab.url,
        options: {
          maxActions: 20,
          localBurstCount: 4
        }
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || '작업 시작 실패');
    }

    statusEl.textContent = `작업 생성됨: ${response.jobId}\n로컬 탐색 + 서버 분석 진행 중`; 
  } catch (error) {
    statusEl.textContent = `오류: ${error.message}`;
  } finally {
    runBtn.disabled = false;
  }
});
