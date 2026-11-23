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

리버스 프록시를 거쳐 다른 주소로 접속하는 경우에는 서버를 `127.0.0.1`에 둔 채
해당 Origin만 허용할 수 있습니다. `--allow-origin`은 여러 번 지정할 수 있으며
`http(s)://호스트[:포트]` 형식만 받습니다. 예를 들어 Tailscale Serve를 사용할 때는
다음과 같이 실행합니다.

```powershell
tailscale serve --bg 8787
.\AnimaStudio.exe --port 8787 --allow-origin https://mypc.tailnet-name.ts.net
```

`--port`를 지정하면 포트가 사용 중일 때 다른 포트로 넘어가지 않으므로 프록시
대상과 실제 포트가 어긋나지 않습니다.

허용한 Origin에 접속할 수 있는 사람은 누구나 앱 전체를 사용할 수 있으니 주의하세요.

## 개발

```powershell
bun install
bun run dev
```

검사와 빌드는 각각 `bun run typecheck`, `bun run test`, `bun run build`로 실행합니다.
