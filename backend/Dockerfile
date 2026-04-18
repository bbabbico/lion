# Node.js 20 버전을 기본 이미지로 사용합니다. 배포 환경에서 안정적인 Debian bookworm을 기반으로 합니다.
FROM node:20-bookworm

# 컨테이너 내 작업 디렉토리 설정
WORKDIR /usr/src/app

# package.json 및 package-lock.json 복사
COPY package*.json ./

# Node.js 의존성 설치
RUN npm install

# Playwright와 실행에 필요한 OS 종속성(라이브러리 패키지들)을 통합 설치합니다.
# 코드에서 chromium만 사용하므로 chromium 브라우저만 설치하여 이미지 용량을 최소화합니다.
RUN npx playwright install --with-deps chromium

# 프로젝트 소스 코드 복사
COPY . .

# 외부로 노출할 포트 설정
EXPOSE 3000

# 서버 실행 명령어
CMD ["node", "server.js"]
