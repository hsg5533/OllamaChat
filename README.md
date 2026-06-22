# OllamaChat

폰에서 동작하는 **tool-calling AI 에이전트**. PC에서 돌아가는 [Ollama](https://ollama.com) 서버와 대화하며, 모델이 직접 도구(파일·웹·전화·알람 등)를 호출한다. React Native(Android, New Architecture).

음성 입력(STT)·음성 출력(TTS)·이미지(vision)까지 지원하는 멀티모달 비서.

---

## 주요 기능

- **Tool-calling 에이전트** — 모델이 필요할 때 도구를 호출하고, 결과를 받아 최종 답변
- **멀티모달** — 이미지 첨부(갤러리/카메라/Download), 한국어 음성 입력(🎤)·답변 음성 출력(🔊)
- **모델 선택** — 설정 화면에서 `/api/tags`로 설치된 모델 목록을 불러와 선택
- **스트리밍 느낌의 타이핑 애니메이션**, 다크 UI, react-navigation 스택

## 도구 목록

| 분류                 | 도구                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------ |
| 파일 (Download 폴더) | `list_files` `read_file` `write_file` `append_file` `delete_file` `file_exists`            |
| 웹                   | `web_search` (DuckDuckGo, 키 불필요) · `fetch_url` (페이지 요약) · `get_weather` (wttr.in) |
| 폰                   | `call_phone` `send_sms` `open_map` `send_email` `share_text` `set_alarm`                   |
| 기기                 | `clipboard_get` `clipboard_set` `device_status` `get_location` `find_contact`              |
| 입력                 | 이미지 vision · 음성(STT) · 음성 답변(TTS)                                                 |

> STT / TTS / 알람은 외부 라이브러리 없이 **자체 네이티브 모듈**(SpeechRecognizer / TextToSpeech / AlarmClock)로 구현.

## 요구 사항

- Node 18+ (테스트: v22), Android SDK + JDK 17, 실기기 또는 에뮬레이터
- PC에 Ollama 실행 + **vision 지원 모델**(예: `gemma3`/`gemma 멀티모달`, `qwen2.5` 등 tool-calling 모델)

## localhost 함정 (꼭 읽기)

폰은 PC가 아니다. 폰의 `localhost`는 폰 자신을 가리킨다.

1. **Ollama를 모든 인터페이스로 바인딩** 후 재시작:
   ```powershell
   $env:OLLAMA_HOST="0.0.0.0:11434"; ollama serve
   ```
2. 폰과 PC가 **같은 Wi-Fi**
3. 앱 설정(⚙︎)의 Host에 **PC의 LAN IP** 입력 (예: `http://192.168.0.27:11434`)
4. Windows 방화벽이 11434 막으면 허용

폰 브라우저에서 `http://<PC-IP>:11434` 열어 "Ollama is running" 뜨면 연결 OK.

## 실행

```sh
npm install
npm start                 # Metro
npm run android           # 빌드 + 기기 설치
```

실기기 USB 연결 시 Metro 연결:

```sh
adb reverse tcp:8081 tcp:8081
```

## 사용

1. ⚙︎ → Host(PC IP) 입력, ↻로 모델 불러와 선택, Save
2. (선택) ⚙︎ → "Grant file access"로 파일 권한 허용 (Download 읽기/쓰기용)
3. 질문 입력 또는 🎤로 말하기. 🔊 켜면 답변을 음성으로 읽어줌
4. ＋ 로 이미지 첨부(갤러리/카메라/Download)

## 아키텍처

```
App.tsx                     네비게이션 루트 (Chat / Settings)
src/
├─ ChatScreen.tsx           채팅 UI, 이미지·음성 입력, TTS
├─ SettingsScreen.tsx       Host + /api/tags 모델 선택
├─ settings.tsx             host/model 공유 컨텍스트 (AsyncStorage)
├─ agent.ts                 에이전트 루프 (chat → tool 호출 → 반복)
└─ tools.ts                 도구 정의 + 실행기
android/.../com/ollamachat/
├─ AlarmModule.kt           시스템 알람 (int extra)
├─ SpeakModule.kt           TTS (TextToSpeech, 한국어)
└─ SttModule.kt             STT (SpeechRecognizer, 한국어)
```

에이전트는 Ollama `/api/chat` REST를 `fetch`로 직접 호출한다. 이미지가 첨부된 턴에는 도구를 끄고 vision으로만 답한다.

## 도구 추가

`src/tools.ts`에 `AgentTool`(JSON schema `definition` + async `run`) 하나 추가하고 `tools` 배열에 넣으면 끝.

## 기술 스택

React Native 0.86 · react-navigation · @dr.pogodin/react-native-fs · react-native-image-picker · device-info · geolocation · contacts · clipboard
