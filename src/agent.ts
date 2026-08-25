import { initLlama, type LlamaContext } from 'llama.rn';
import RNBlobUtil from 'react-native-blob-util';
import { toolDefs, toolMap } from './tools';
import type { ApiType } from './settings';

const name = 'gemma-4-E2B-it-qat-UD-Q4_K_XL.gguf';
const path = `${RNBlobUtil.fs.dirs.DocumentDir}/${name}`;

export interface Chat {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[];
  tool_name?: string;
  tool_calls?: {
    type: 'function';
    function: { name: string; arguments: Record<string, any> | string };
  }[];
}

type Event =
  | { type: 'tool_call'; name: string; args: Record<string, any> }
  | { type: 'tool_result'; name: string; result: string };

const system =
  '당신은 도구를 사용할 수 있는 유능한 비서입니다. 항상 한국어로 답하세요. 모르는 내용이거나 최신 정보가 필요하면 `web_search`로 검색하고 필요하면 `fetch_url`로 결과 페이지를 읽은 뒤 설명하며, 다운로드 폴더의 파일 작업에는 `list_files`/`read_file`/`write_file`/`append_file`/`delete_file`/`file_exists`를 사용하고, 날씨는 `get_weather`, 웹/지도/메일은 `open_url`/`open_map`/`send_email`, 공유는 `share_text`, 알람은 `set_alarm`, 타이머는 `set_timer`, 전화는 `call_phone`, 문자는 `send_sms`, 캘린더 일정 추가는 `add_calendar_event`, 일정 조회는 `read_calendar`, 연락처 추가는 `create_contact`, 클립보드는 `clipboard_get`/`clipboard_set`, 기기 상태는 `device_status`, 위치는 `get_location`, 연락처 검색은 `find_contact`, 손전등은 `flashlight`, 진동은 `vibrate`, 볼륨은 `set_volume`, 알림은 `notify`를 사용하며, 도구로 얻을 수 있는 값을 추측하지 말고, 도구 결과를 받은 뒤에는 그 결과를 바탕으로 간결하게 최종 답변을 하세요.';

let pause = false;
let context: LlamaContext | null = null;
let controller: AbortController | null = null;

async function isUsable(path: string) {
  if (!(await RNBlobUtil.fs.exists(path))) return false;
  const stat = await RNBlobUtil.fs.stat(path);
  return Number(stat.size) > 2_620_370_976 * 0.95;
}

async function prepare() {
  if (await isUsable(path)) return path;
  const tmp = `${path}.part`;
  (await RNBlobUtil.fs.exists(tmp)) && (await RNBlobUtil.fs.unlink(tmp));
  await RNBlobUtil.fs.cp(RNBlobUtil.fs.asset(name), tmp);
  (await RNBlobUtil.fs.exists(path)) && (await RNBlobUtil.fs.unlink(path));
  await RNBlobUtil.fs.mv(tmp, path);
  return path;
}

async function unload() {
  if (!context) return;
  const current = context;
  context = null;
  await current.release();
}

async function load(path: string) {
  await unload();
  context = await initLlama({
    model: path,
    n_ctx: 4096,
    n_batch: 512,
    n_parallel: 1,
    n_gpu_layers: 0,
  });
}

async function generate(messages: Chat[], tools?: object) {
  if (!context) throw new Error('모델이 로드되지 않았습니다.');
  return context.completion({
    messages: [{ role: 'system', content: system }, ...messages],
    n_predict: 1024,
    temperature: 0,
    jinja: true,
    enable_thinking: true,
    reasoning_format: 'auto',
    tools,
  });
}

async function onDevice(chat: Chat[], tool: boolean): Promise<Chat> {
  await load(await prepare());
  const result = await generate(
    chat.filter(m => m.role !== 'system'),
    tool ? toolDefs : undefined,
  );
  return {
    role: 'assistant',
    content: result.content,
    tool_calls: result.tool_calls,
  };
}

function normalize(message: Chat): Chat {
  return {
    ...message,
    content: message.content ?? '',
    tool_calls: message.tool_calls?.map(c => ({
      type: 'function',
      function: c.function,
    })),
  };
}

async function call(
  host: string,
  model: string,
  type: ApiType,
  tool: boolean,
  chat: Chat[],
  event?: Event[],
): Promise<Chat> {
  pause = false;
  controller = new AbortController();
  const timeout = setTimeout(() => controller && controller.abort(), 10000);
  try {
    const res = await fetch(
      type === 'llama' ? `${host}/v1/chat/completions` : `${host}/api/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          type === 'llama'
            ? {
                model,
                messages: chat,
                stream: false,
                temperature: 0,
                tools: tool ? toolDefs : undefined,
              }
            : {
                model,
                messages: chat,
                stream: false,
                tools: tool ? toolDefs : undefined,
                options: { temperature: 0, num_ctx: 8192 },
              },
        ),
        signal: controller.signal,
      },
    );
    if (res.ok) {
      const data = await res.json();
      return type === 'llama' ? data.choices[0].message : data.message;
    }
    throw new Error(`Server HTTP ${res.status}: ${await res.text()}`);
  } catch (err) {
    if (pause || !event) throw err;
    event.push({
      type: 'tool_result',
      name: 'offline',
      result: '오프라인 모델로 답변합니다.',
    });
    return await onDevice(chat, tool);
  } finally {
    clearTimeout(timeout);
    controller = null;
  }
}

export type Agent = ReturnType<typeof createAgent>;

export function createAgent(
  host: string,
  model: string,
  type: ApiType = 'ollama',
  offline = false,
) {
  const history: Chat[] = [{ role: 'system', content: system }];
  return async (input: string, images?: string[]) => {
    const hasImages = images && images.length > 0;
    const userMsg: Chat = { role: 'user', content: input };
    if (hasImages) userMsg.images = images;
    history.push(userMsg);
    if (hasImages) {
      const result = await call(host, model, type, false, [
        { role: 'user', content: input, images },
      ]);
      const message = normalize({ ...result, role: 'assistant' });
      history.push(message);
      return { answer: message.content, event: [] };
    }
    const event: Event[] = [];
    if (offline) {
      event.push({
        type: 'tool_result',
        name: 'offline',
        result: '오프라인 모델로 답변합니다.',
      });
    }
    for (;;) {
      const message = normalize(
        offline
          ? await onDevice(history, true)
          : await call(host, model, type, true, history, event),
      );
      history.push(message);
      const calls = (message.tool_calls ?? []).map(c => {
        const name = c.function.name;
        if (typeof c.function.arguments !== 'string')
          return { name, args: c.function.arguments };
        try {
          return { name, args: JSON.parse(c.function.arguments) };
        } catch {
          return { name, args: {} };
        }
      });
      if (calls.length === 0) {
        const answer = message.content?.trim()
          ? message.content
          : '모델이 빈 응답을 반환했습니다.';
        return { answer, event };
      }
      for (const { name, args } of calls) {
        event.push({ type: 'tool_call', name, args });
        const tool = toolMap.get(name);
        const result = tool
          ? await tool.run(args)
          : `error: unknown tool '${name}'`;
        event.push({ type: 'tool_result', name, result });
        history.push({ role: 'tool', tool_name: name, content: result });
      }
    }
  };
}

export async function stop() {
  pause = true;
  controller && controller.abort();
  context && (await context.stopCompletion());
}
