const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios'); // 백엔드에서 직접 사이트 접속을 위해 추가

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 🔥 핵심: Node.js의 통신이 mitmproxy(기본포트 8080)를 거쳐가도록 설정
const proxyConfig = {
    host: '127.0.0.1',
    port: 8080,
    protocol: 'http'
};

// 프록시(Python)가 보낸 웹훅을 받는 곳
app.post('/webhook', (req, res) => {
    console.log('🎯 [Backend] 프록시에서 이벤트 감지 완료! 클라이언트로 신호 발사!');
    
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ action: 'TRIGGER_RANDOM_CLICK' }));
        }
    });
    
    res.status(200).send({ status: 'success' });
});

// WebSocket 연결 및 클라이언트 명령 대기
wss.on('connection', (ws) => {
    console.log('🟢 [Backend] 확장 프로그램 연결됨');

    // 확장 프로그램이 "이 사이트 접속해!" 라고 명령을 보냈을 때
    ws.on('message', async (message) => {
        const data = JSON.parse(message);
        
        if (data.action === 'START_BACKEND_FETCH') {
            console.log(`🚀 [Backend] 명령 수신. 타겟 접속 시작: ${data.url}`);
            
            try {
                // 백엔드가 직접 해당 URL로 접속 (프록시를 거쳐서)
                await axios.get(data.url, {
                    proxy: proxyConfig,
                    // mitmproxy의 자체 인증서를 통과하기 위해 필수 설정
                    rejectUnauthorized: false 
                });
                console.log('✅ [Backend] 타겟 서버 응답 완료 (프록시가 중간에서 패킷을 확인했습니다)');
            } catch (error) {
                console.error('❌ [Backend] 타겟 서버 접속 실패:', error.message);
            }
        }
    });

    ws.on('close', () => console.log('🔴 [Backend] 연결 끊김'));
});

server.listen(3000, () => {
    console.log('🚀 Node.js 백엔드 실행 중: http://localhost:3000');
});