import * as RNFS from '@dr.pogodin/react-native-fs';
import { Linking, NativeModules, PermissionsAndroid, Share } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import DeviceInfo from 'react-native-device-info';
import Geolocation from '@react-native-community/geolocation';
import Contacts from 'react-native-contacts';

// File tools read/write the phone's public Download folder by direct path.
// Requires "All files access" (MANAGE_EXTERNAL_STORAGE) to be granted.
export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export interface AgentTool {
  definition: ToolDef;
  run: (args: Record<string, any>) => Promise<string>;
}

// --- File tools: public Download folder, direct path (needs All files access) ---
const DOWNLOAD = RNFS.DownloadDirectoryPath;

function downloadPath(path: string): string {
  const name = path.replace(/^\/+/, '');
  if (!name || name.includes('..') || name.includes('/')) {
    throw new Error(`invalid file name: ${path}`);
  }
  return `${DOWNLOAD}/${name}`;
}

const listFileTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'list_files',
      description: "List files in the phone's Download folder.",
      parameters: { type: 'object', properties: {} },
    },
  },
  run: async () => {
    try {
      const entries = await RNFS.readDir(DOWNLOAD);
      return (
        entries
          .map((e: RNFS.ReadDirResItemT) =>
            e.isDirectory() ? `${e.name}/` : e.name,
          )
          .join('\n') || '(empty)'
      );
    } catch (e) {
      return `error: ${(e as Error).message}`;
    }
  },
};

const readFileTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        "Read a text file from the phone's Download folder. Returns up to 4000 chars.",
      parameters: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: "file name, e.g. 'notes.txt'" },
        },
      },
    },
  },
  run: async ({ path }) => {
    try {
      const content = await RNFS.readFile(downloadPath(path), 'utf8');
      return content.slice(0, 4000);
    } catch (e) {
      return `error: ${(e as Error).message}`;
    }
  },
};

const writeFileTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        "Write text to a file in the phone's Download folder. Overwrites if it exists.",
      parameters: {
        type: 'object',
        required: ['path', 'content'],
        properties: {
          path: { type: 'string', description: "file name, e.g. 'notes.txt'" },
          content: { type: 'string', description: 'text to write' },
        },
      },
    },
  },
  run: async ({ path, content }) => {
    try {
      await RNFS.writeFile(downloadPath(path), String(content ?? ''), 'utf8');
      return `saved to Download/${path}`;
    } catch (e) {
      return `error: ${(e as Error).message}`;
    }
  },
};

// --- Web tool: fetch a page's readable text (model summarizes it) ---
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const fetchUrlTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'fetch_url',
      description:
        'Fetch a web page and return its readable text (HTML stripped). Use this to read or summarize a website.',
      parameters: {
        type: 'object',
        required: ['url'],
        properties: {
          url: {
            type: 'string',
            description: 'page URL, e.g. https://example.com',
          },
        },
      },
    },
  },
  run: async ({ url }) => {
    try {
      const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      const res = await fetch(target, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (!res.ok) {
        return `error: HTTP ${res.status}`;
      }
      const text = htmlToText(await res.text());
      return text.slice(0, 6000) || '(no readable text found)';
    } catch (e) {
      return `error: ${(e as Error).message}`;
    }
  },
};

// --- Web search (keyless, DuckDuckGo HTML) ---
const webSearchTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        "Search the web and return result titles, snippets, and links. Use this whenever you don't know something or need current/up-to-date info.",
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'search query' },
        },
      },
    },
  },
  run: async ({ query }) => {
    try {
      const res = await fetch(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } },
      );
      if (!res.ok) {
        return `error: HTTP ${res.status}`;
      }
      const text = htmlToText(await res.text());
      return text.slice(0, 4000) || '(no results)';
    } catch (e) {
      return `error: ${(e as Error).message}`;
    }
  },
};

// --- Phone tools: open the dialer / SMS composer (user confirms the action) ---
function cleanNumber(n: string): string {
  return String(n).replace(/[^\d+*#]/g, '');
}

const callPhoneTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'call_phone',
      description:
        'Open the phone dialer with a number ready to call. The user must press call.',
      parameters: {
        type: 'object',
        required: ['number'],
        properties: {
          number: {
            type: 'string',
            description: 'phone number, e.g. 010-1234-5678',
          },
        },
      },
    },
  },
  run: async ({ number }) => {
    try {
      await Linking.openURL(`tel:${cleanNumber(number)}`);
      return `opened dialer for ${number}`;
    } catch (e) {
      return `error: ${(e as Error).message}`;
    }
  },
};

const sendSmsTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'send_sms',
      description:
        'Open the SMS app with the recipient and message prefilled. The user must press send.',
      parameters: {
        type: 'object',
        required: ['number', 'message'],
        properties: {
          number: { type: 'string', description: 'recipient phone number' },
          message: { type: 'string', description: 'message text' },
        },
      },
    },
  },
  run: async ({ number, message }) => {
    try {
      const body = encodeURIComponent(String(message ?? ''));
      await Linking.openURL(`sms:${cleanNumber(number)}?body=${body}`);
      return `opened SMS composer for ${number}`;
    } catch (e) {
      return `error: ${(e as Error).message}`;
    }
  },
};

// --- Weather (keyless, wttr.in) ---
const weatherTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get the current weather for a city.',
      parameters: {
        type: 'object',
        required: ['city'],
        properties: {
          city: { type: 'string', description: 'city name, e.g. Seoul' },
        },
      },
    },
  },
  run: async ({ city }) => {
    try {
      const res = await fetch(
        `https://wttr.in/${encodeURIComponent(city)}?format=j1`,
        { headers: { 'User-Agent': 'curl/8' } },
      );
      if (!res.ok) {
        return `error: HTTP ${res.status}`;
      }
      const d = await res.json();
      const c = d.current_condition?.[0];
      if (!c) {
        return '(no data)';
      }
      return `${city}: ${c.temp_C}°C (feels ${c.FeelsLikeC}°C), ${
        c.weatherDesc?.[0]?.value
      }, humidity ${c.humidity}%, wind ${c.windspeedKmph}km/h`;
    } catch (e) {
      return `error: ${(e as Error).message}`;
    }
  },
};

// --- Linking tools: open things in other apps ---
const openUrlTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'open_url',
      description: 'Open a URL in the browser or its app.',
      parameters: {
        type: 'object',
        required: ['url'],
        properties: { url: { type: 'string', description: 'URL to open' } },
      },
    },
  },
  run: async ({ url }) => {
    try {
      const target = /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`;
      await Linking.openURL(target);
      return `opened ${target}`;
    } catch (e) {
      return `error: ${(e as Error).message}`;
    }
  },
};

const openMapTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'open_map',
      description: 'Open a place or address in the maps app.',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'place or address' },
        },
      },
    },
  },
  run: async ({ query }) => {
    try {
      await Linking.openURL(`geo:0,0?q=${encodeURIComponent(query)}`);
      return `opened map for ${query}`;
    } catch (e) {
      return `error: ${(e as Error).message}`;
    }
  },
};

const sendEmailTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'send_email',
      description:
        'Open the email app with a draft prefilled. The user must press send.',
      parameters: {
        type: 'object',
        required: ['to'],
        properties: {
          to: { type: 'string', description: 'recipient email' },
          subject: { type: 'string', description: 'subject' },
          body: { type: 'string', description: 'email body' },
        },
      },
    },
  },
  run: async ({ to, subject, body }) => {
    try {
      const q = `subject=${encodeURIComponent(
        subject ?? '',
      )}&body=${encodeURIComponent(body ?? '')}`;
      await Linking.openURL(`mailto:${to}?${q}`);
      return `opened email draft to ${to}`;
    } catch (e) {
      return `error: ${(e as Error).message}`;
    }
  },
};

const shareTextTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'share_text',
      description: 'Open the system share sheet with some text.',
      parameters: {
        type: 'object',
        required: ['text'],
        properties: { text: { type: 'string', description: 'text to share' } },
      },
    },
  },
  run: async ({ text }) => {
    try {
      await Share.share({ message: String(text ?? '') });
      return 'opened share sheet';
    } catch (e) {
      return `error: ${(e as Error).message}`;
    }
  },
};

const setAlarmTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'set_alarm',
      description: "Set an alarm in the phone's clock app.",
      parameters: {
        type: 'object',
        required: ['hour', 'minute'],
        properties: {
          hour: { type: 'number', description: 'hour 0-23' },
          minute: { type: 'number', description: 'minute 0-59' },
          message: { type: 'string', description: 'alarm label' },
        },
      },
    },
  },
  run: async ({ hour, minute, message }) => {
    try {
      // Native module so int extras reach the clock app (Linking.sendIntent
      // would pass them as Double, which AlarmClock ignores).
      await NativeModules.AlarmModule.setAlarm(
        Number(hour),
        Number(minute),
        String(message ?? 'Alarm'),
      );
      return `alarm set for ${hour}:${String(minute).padStart(2, '0')}`;
    } catch (e) {
      return `error: ${(e as Error).message}`;
    }
  },
};

// --- File extras ---
const deleteFileTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'delete_file',
      description: "Delete a file from the phone's Download folder.",
      parameters: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: "file name, e.g. 'notes.txt'" },
        },
      },
    },
  },
  run: async ({ path }) => {
    try {
      await RNFS.unlink(downloadPath(path));
      return `deleted ${path}`;
    } catch (e) {
      return `error: ${(e as Error).message}`;
    }
  },
};

const appendFileTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'append_file',
      description: 'Append text to a file in the Download folder (creates it if missing).',
      parameters: {
        type: 'object',
        required: ['path', 'content'],
        properties: {
          path: { type: 'string', description: "file name, e.g. 'log.txt'" },
          content: { type: 'string', description: 'text to append' },
        },
      },
    },
  },
  run: async ({ path, content }) => {
    try {
      await RNFS.appendFile(downloadPath(path), String(content ?? ''), 'utf8');
      return `appended to ${path}`;
    } catch (e) {
      return `error: ${(e as Error).message}`;
    }
  },
};

const fileExistsTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'file_exists',
      description: 'Check whether a file exists in the Download folder.',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: "file name, e.g. 'notes.txt'" },
        },
      },
    },
  },
  run: async ({ path }) => {
    try {
      const exists = await RNFS.exists(downloadPath(path));
      return exists ? 'yes' : 'no';
    } catch (e) {
      return `error: ${(e as Error).message}`;
    }
  },
};

// --- Native device tools ---
const clipboardSetTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'clipboard_set',
      description: 'Copy text to the clipboard.',
      parameters: {
        type: 'object',
        required: ['text'],
        properties: { text: { type: 'string', description: 'text to copy' } },
      },
    },
  },
  run: async ({ text }) => {
    try {
      Clipboard.setString(String(text ?? ''));
      return 'copied to clipboard';
    } catch (e) {
      return `error: ${(e as Error).message}`;
    }
  },
};

const clipboardGetTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'clipboard_get',
      description: 'Read the current clipboard text.',
      parameters: { type: 'object', properties: {} },
    },
  },
  run: async () => {
    try {
      return (await Clipboard.getString()) || '(empty)';
    } catch (e) {
      return `error: ${(e as Error).message}`;
    }
  },
};

const deviceStatusTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'device_status',
      description: 'Get phone status: battery level, charging, model, OS version.',
      parameters: { type: 'object', properties: {} },
    },
  },
  run: async () => {
    try {
      const battery = Math.round((await DeviceInfo.getBatteryLevel()) * 100);
      const charging = await DeviceInfo.isBatteryCharging();
      const model = DeviceInfo.getModel();
      const os = `${DeviceInfo.getSystemName()} ${DeviceInfo.getSystemVersion()}`;
      return `battery ${battery}%${charging ? ' (charging)' : ''}, ${model}, ${os}`;
    } catch (e) {
      return `error: ${(e as Error).message}`;
    }
  },
};

const locationTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'get_location',
      description: "Get the phone's current GPS coordinates (latitude, longitude).",
      parameters: { type: 'object', properties: {} },
    },
  },
  run: async () => {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
      return 'error: location permission denied';
    }
    return new Promise<string>(resolve => {
      Geolocation.getCurrentPosition(
        pos =>
          resolve(
            `lat ${pos.coords.latitude}, lng ${pos.coords.longitude} (±${Math.round(
              pos.coords.accuracy,
            )}m)`,
          ),
        err => resolve(`error: ${err.message}`),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
      );
    });
  },
};

const contactsTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'find_contact',
      description: 'Look up a contact by name and return their phone number(s).',
      parameters: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'contact name to search' },
        },
      },
    },
  },
  run: async ({ name }) => {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
    );
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
      return 'error: contacts permission denied';
    }
    try {
      const found = await Contacts.getContactsMatchingString(String(name));
      if (!found.length) {
        return `no contact found for '${name}'`;
      }
      return found
        .slice(0, 5)
        .map(
          c =>
            `${c.displayName}: ${c.phoneNumbers
              .map(p => p.number)
              .join(', ')}`,
        )
        .join('\n');
    } catch (e) {
      return `error: ${(e as Error).message}`;
    }
  },
};

export const tools: AgentTool[] = [
  listFileTool,
  readFileTool,
  writeFileTool,
  deleteFileTool,
  appendFileTool,
  fileExistsTool,
  webSearchTool,
  fetchUrlTool,
  weatherTool,
  openUrlTool,
  openMapTool,
  sendEmailTool,
  shareTextTool,
  setAlarmTool,
  callPhoneTool,
  sendSmsTool,
  clipboardSetTool,
  clipboardGetTool,
  deviceStatusTool,
  locationTool,
  contactsTool,
];
export const toolMap = new Map(tools.map(t => [t.definition.function.name, t]));
export const toolDefs = tools.map(t => t.definition);
