import { initLlama, type LlamaContext } from 'llama.rn';

export type Chat = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
};

const system =
  '너는 사용자의 기기 안에서만 동작하는 오프라인 비서다. 한국어로 물으면 한국어로 답한다. 모르는 것은 모른다고 말한다.';

let context: LlamaContext | null = null;

/** GGUF 파일을 메모리에 올린다. 이미 올라와 있으면 먼저 내린다. */
export async function load(path: string) {
  await unload();
  context = await initLlama({
    model: path,
    n_ctx: 4096,
    n_batch: 512,
    n_gpu_layers: 0, // CPU 추론. 기기 GPU 오프로드를 쓰려면 99. (현재 llama.rn은 iOS에서만 지원)
    // 이 앱은 한 번에 하나의 대화만 처리한다. 기본값(8)은 안 쓰는 병렬 시퀀스
    // 슬롯까지 버퍼를 잡아 느려지므로 1로 줄인다.
    n_parallel: 1,
  });
}

export async function unload() {
  if (!context) return;
  const current = context;
  context = null;
  await current.release();
}

/**
 * 한 번의 대화 턴을 생성한다. tools 를 넘기면 모델이 함수 호출을 요청할 수 있고,
 * 그 경우 result.tool_calls 에 담겨 온다 (jinja 템플릿이 지원해야 동작).
 */
export async function generate(messages: Chat[], tools?: object) {
  if (!context) throw new Error('모델이 로드되지 않았습니다.');

  // result.text 는 thinking 이 붙은 원문이라 폴백으로 쓰면 안 된다. content 를 쓴다.
  return context.completion({
    messages: [{ role: 'system', content: system }, ...messages],
    n_predict: 1024,
    temperature: 0,
    jinja: true, // jinja 를 켜야 Gemma 4 의 thinking 채널을 파싱할 수 있다.
    enable_thinking: true,
    // 기본값 'none' 은 thinking 을 content 안에 그대로 둔다 → 답에 생각이 섞여 나온다.
    reasoning_format: 'auto',
    tools,
  });
}

export async function stop() {
  if (!context) return;
  await context.stopCompletion();
}
