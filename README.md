# Anima Studio

Anima와 Instant Reference LoRA를 위한 Windows용 로컬 AI 이미지 생성 앱입니다.

## 주요 기능

- ComfyUI 설치 및 실행 관리
- 여러 참조 이미지를 활용한 이미지 생성
- 생성 진행률, 미리보기, 기록 및 결과 비교
- 오프라인 Danbooru 태그 자동완성
- Hugging Face와 Civitai 모델 관리

## 요구 사항

- Windows x64
- NVIDIA GPU와 정상 동작하는 드라이버
- 엔진 설치를 위한 25 GiB 이상의 여유 공간과 인터넷 연결

## 사용 방법

`AnimaStudio.exe`를 실행한 뒤 **엔진 설치**와 모델 설치를 완료하고 이미지를 생성하세요.

기본적으로 `127.0.0.1`의 8787번 포트부터 사용 가능한 포트를 찾아 실행합니다.
IPv4 주소와 포트를 직접 지정하려면 다음 실행 옵션을 사용하세요.

```powershell
.\AnimaStudio.exe --host 192.168.0.20 --port 9000
```

`--host 0.0.0.0`은 모든 네트워크 인터페이스에 서버를 공개하고 API Origin
제한도 해제합니다. 별도 인증이나 TLS를 제공하지 않으므로 신뢰할 수 있는
네트워크에서만 사용하세요.

## 개발

```powershell
bun install
bun run dev
```

검사와 빌드는 각각 `bun run typecheck`, `bun run test`, `bun run build`로 실행합니다.
