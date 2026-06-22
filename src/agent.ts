import { toolDefs, toolMap } from './tools';

// Minimal Ollama chat types (subset of REST API).
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_name?: string;
  images?: string[]; // base64-encoded images (no data: prefix)
  tool_calls?: {
    function: { name: string; arguments: Record<string, any> | string };
  }[];
}

export type AgentEvent =
  | { type: 'tool_call'; name: string; args: Record<string, any> }
  | { type: 'tool_result'; name: string; result: string };

const SYSTEM_PROMPT =
  '당신은 도구를 사용할 수 있는 유능한 비서입니다. 항상 한국어로 답하세요. 모르는 내용이거나 최신 정보가 필요하면 `web_search`로 검색하고 필요하면 `fetch_url`로 결과 페이지를 읽은 뒤 설명하며, 다운로드 폴더의 파일 작업에는 `list_files`/`read_file`/`write_file`/`append_file`/`delete_file`/`file_exists`를 사용하고, 날씨는 `get_weather`, 웹/지도/메일은 `open_url`/`open_map`/`send_email`, 공유는 `share_text`, 알람은 `set_alarm`, 전화는 `call_phone`, 문자는 `send_sms`, 클립보드는 `clipboard_get`/`clipboard_set`, 기기 상태는 `device_status`, 위치는 `get_location`, 연락처 검색은 `find_contact`를 사용하며, 도구로 얻을 수 있는 값을 추측하지 말고, 도구 결과를 받은 뒤에는 그 결과를 바탕으로 간결하게 최종 답변을 하세요.';

export class Agent {
  private host: string;
  private model: string;
  private maxSteps: number;
  private history: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];

  constructor(opts: { host: string; model: string; maxSteps?: number }) {
    this.host = opts.host.replace(/\/$/, '');
    this.model = opts.model;
    this.maxSteps = opts.maxSteps ?? 8;
  }

  reset() {
    this.history = [{ role: 'system', content: SYSTEM_PROMPT }];
  }

  private async chat(useTools: boolean): Promise<ChatMessage> {
    const res = await fetch(`${this.host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: this.history,
        // Omit tools when an image is in play so the model uses vision to
        // describe it instead of reaching for web_search.
        tools: useTools ? toolDefs : undefined,
        stream: false,
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    return data.message as ChatMessage;
  }

  async ask(
    userInput: string,
    onEvent?: (e: AgentEvent) => void,
    images?: string[],
  ): Promise<string> {
    const userMsg: ChatMessage = { role: 'user', content: userInput };
    if (images && images.length > 0) {
      userMsg.images = images;
    }
    this.history.push(userMsg);

    // With an image attached, answer from vision only (no tool calls).
    const useTools = !(images && images.length > 0);

    for (let step = 0; step < this.maxSteps; step++) {
      const msg = await this.chat(useTools);
      this.history.push(msg);

      const calls = msg.tool_calls ?? [];
      if (calls.length === 0) {
        return msg.content;
      }

      for (const call of calls) {
        const name = call.function.name;
        // Some models return arguments as a JSON string instead of an object.
        const raw = call.function.arguments ?? {};
        let args: Record<string, any>;
        if (typeof raw === 'string') {
          try {
            args = JSON.parse(raw);
          } catch {
            args = {};
          }
        } else {
          args = raw;
        }
        onEvent?.({ type: 'tool_call', name, args });

        const tool = toolMap.get(name);
        const result = tool
          ? await tool.run(args)
          : `error: unknown tool '${name}'`;

        onEvent?.({ type: 'tool_result', name, result });
        this.history.push({ role: 'tool', tool_name: name, content: result });
      }
    }
    return `(stopped: reached max ${this.maxSteps} steps)`;
  }
}
