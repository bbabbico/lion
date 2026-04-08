import urllib.request
import json
from mitmproxy import http

class TargetInterceptor:
    def response(self, flow: http.HTTPFlow):
        # 🔥 타겟 조건 설정: 감지하고 싶은 숨겨진 JS/API의 URL이나 키워드를 여기에 넣으세요.
        # 예시: 응답 URL에 'secret-api'가 포함되어 있고, 상태 코드가 200(성공)일 때
        target_keyword = "secret-api" 

        if target_keyword in flow.request.pretty_url and flow.response.status_code == 200:
            print(f"🕵️‍♂️ [Proxy] 타겟 응답 감지 완료: {flow.request.pretty_url}")

            # 백엔드 서버로 POST 요청 (웹훅) 전송
            req = urllib.request.Request(
                'http://localhost:3000/webhook',
                data=json.dumps({"detected_url": flow.request.pretty_url}).encode('utf-8'),
                headers={'Content-Type': 'application/json'}
            )
            try:
                urllib.request.urlopen(req)
                print("✅ [Proxy] 백엔드로 실행 신호 전송 성공")
            except Exception as e:
                print(f"❌ [Proxy] 백엔드 전송 실패: {e}")

addons = [
    TargetInterceptor()
]