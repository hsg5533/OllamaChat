import * as RNFS from '@dr.pogodin/react-native-fs';
import {
  Linking,
  NativeModules,
  PermissionsAndroid,
  Platform,
  Share,
} from 'react-native';
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

// Wrap a tool body so any thrown error becomes a uniform "error: ..." string.
// Lets each tool focus on its happy path instead of repeating try/catch.
function safe(
  fn: (args: Record<string, any>) => Promise<string>,
): AgentTool['run'] {
  return async args => {
    try {
      return await fn(args);
    } catch (e) {
      return `error: ${(e as Error).message}`;
    }
  };
}

// Request an Android runtime permission; throw if the user denies it (the
// thrown message is surfaced via safe() as "error: <label> permission denied").
async function requirePermission(
  perm: Parameters<typeof PermissionsAndroid.request>[0],
  label: string,
): Promise<void> {
  const granted = await PermissionsAndroid.request(perm);
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error(`${label} permission denied`);
  }
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
  run: safe(async () => {
    const entries = await RNFS.readDir(DOWNLOAD);
    return (
      entries
        .map((e: RNFS.ReadDirResItemT) =>
          e.isDirectory() ? `${e.name}/` : e.name,
        )
        .join('\n') || '(empty)'
    );
  }),
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
  run: safe(async ({ path }) => {
    const content = await RNFS.readFile(downloadPath(path), 'utf8');
    return content.slice(0, 4000);
  }),
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
  run: safe(async ({ path, content }) => {
    await RNFS.writeFile(downloadPath(path), String(content ?? ''), 'utf8');
    return `saved to Download/${path}`;
  }),
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
  run: safe(async ({ url }) => {
    const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const res = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) {
      return `error: HTTP ${res.status}`;
    }
    const text = htmlToText(await res.text());
    return text.slice(0, 6000) || '(no readable text found)';
  }),
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
  run: safe(async ({ query }) => {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } },
    );
    if (!res.ok) {
      return `error: HTTP ${res.status}`;
    }
    const text = htmlToText(await res.text());
    return text.slice(0, 4000) || '(no results)';
  }),
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
  run: safe(async ({ number }) => {
    await Linking.openURL(`tel:${cleanNumber(number)}`);
    return `opened dialer for ${number}`;
  }),
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
  run: safe(async ({ number, message }) => {
    const body = encodeURIComponent(String(message ?? ''));
    await Linking.openURL(`sms:${cleanNumber(number)}?body=${body}`);
    return `opened SMS composer for ${number}`;
  }),
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
  run: safe(async ({ city }) => {
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
    return `${city}: ${c.temp_C}°C (feels ${c.FeelsLikeC}°C), ${c.weatherDesc?.[0]?.value}, humidity ${c.humidity}%, wind ${c.windspeedKmph}km/h`;
  }),
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
  run: safe(async ({ url }) => {
    const target = /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`;
    await Linking.openURL(target);
    return `opened ${target}`;
  }),
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
  run: safe(async ({ query }) => {
    await Linking.openURL(`geo:0,0?q=${encodeURIComponent(query)}`);
    return `opened map for ${query}`;
  }),
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
  run: safe(async ({ to, subject, body }) => {
    const q = `subject=${encodeURIComponent(
      subject ?? '',
    )}&body=${encodeURIComponent(body ?? '')}`;
    await Linking.openURL(`mailto:${to}?${q}`);
    return `opened email draft to ${to}`;
  }),
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
  run: safe(async ({ text }) => {
    await Share.share({ message: String(text ?? '') });
    return 'opened share sheet';
  }),
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
  run: safe(async ({ hour, minute, message }) => {
    // Native module so int extras reach the clock app (Linking.sendIntent
    // would pass them as Double, which AlarmClock ignores).
    await NativeModules.AlarmModule.setAlarm(
      Number(hour),
      Number(minute),
      String(message ?? 'Alarm'),
    );
    return `alarm set for ${hour}:${String(minute).padStart(2, '0')}`;
  }),
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
  run: safe(async ({ path }) => {
    await RNFS.unlink(downloadPath(path));
    return `deleted ${path}`;
  }),
};

const appendFileTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'append_file',
      description:
        'Append text to a file in the Download folder (creates it if missing).',
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
  run: safe(async ({ path, content }) => {
    await RNFS.appendFile(downloadPath(path), String(content ?? ''), 'utf8');
    return `appended to ${path}`;
  }),
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
  run: safe(async ({ path }) => {
    const exists = await RNFS.exists(downloadPath(path));
    return exists ? 'yes' : 'no';
  }),
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
  run: safe(async ({ text }) => {
    Clipboard.setString(String(text ?? ''));
    return 'copied to clipboard';
  }),
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
  run: safe(async () => {
    return (await Clipboard.getString()) || '(empty)';
  }),
};

const deviceStatusTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'device_status',
      description:
        'Get phone status: battery level, charging, model, OS version.',
      parameters: { type: 'object', properties: {} },
    },
  },
  run: safe(async () => {
    const battery = Math.round((await DeviceInfo.getBatteryLevel()) * 100);
    const charging = await DeviceInfo.isBatteryCharging();
    const model = DeviceInfo.getModel();
    const os = `${DeviceInfo.getSystemName()} ${DeviceInfo.getSystemVersion()}`;
    return `battery ${battery}%${
      charging ? ' (charging)' : ''
    }, ${model}, ${os}`;
  }),
};

const locationTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'get_location',
      description:
        "Get the phone's current GPS coordinates (latitude, longitude).",
      parameters: { type: 'object', properties: {} },
    },
  },
  run: safe(async () => {
    await requirePermission(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      'location',
    );
    return new Promise<string>(resolve => {
      Geolocation.getCurrentPosition(
        pos =>
          resolve(
            `lat ${pos.coords.latitude}, lng ${
              pos.coords.longitude
            } (±${Math.round(pos.coords.accuracy)}m)`,
          ),
        err => resolve(`error: ${err.message}`),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
      );
    });
  }),
};

const contactsTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'find_contact',
      description:
        'Look up a contact by name and return their phone number(s).',
      parameters: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'contact name to search' },
        },
      },
    },
  },
  run: safe(async ({ name }) => {
    await requirePermission(
      PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
      'contacts',
    );
    const found = await Contacts.getContactsMatchingString(String(name));
    if (!found.length) {
      return `no contact found for '${name}'`;
    }
    return found
      .slice(0, 5)
      .map(
        c =>
          `${c.displayName}: ${c.phoneNumbers.map(p => p.number).join(', ')}`,
      )
      .join('\n');
  }),
};

// --- More native device tools (self-written native modules) ---
const setTimerTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'set_timer',
      description: "Start a countdown timer in the phone's clock app.",
      parameters: {
        type: 'object',
        required: ['seconds'],
        properties: {
          seconds: { type: 'number', description: 'duration in seconds' },
          message: { type: 'string', description: 'timer label' },
        },
      },
    },
  },
  run: safe(async ({ seconds, message }) => {
    return await NativeModules.AlarmModule.setTimer(
      Number(seconds),
      String(message ?? 'Timer'),
    );
  }),
};

const flashlightTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'flashlight',
      description: 'Turn the phone flashlight on or off.',
      parameters: {
        type: 'object',
        required: ['on'],
        properties: {
          on: { type: 'boolean', description: 'true = on, false = off' },
        },
      },
    },
  },
  run: safe(async ({ on }) => {
    return await NativeModules.DeviceToolsModule.flashlight(!!on);
  }),
};

const vibrateTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'vibrate',
      description: 'Vibrate the phone for a number of milliseconds.',
      parameters: {
        type: 'object',
        properties: {
          ms: { type: 'number', description: 'duration in ms (default 400)' },
        },
      },
    },
  },
  run: safe(async ({ ms }) => {
    return await NativeModules.DeviceToolsModule.vibrate(Number(ms ?? 400));
  }),
};

const setVolumeTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'set_volume',
      description: 'Set the media volume (0-100%).',
      parameters: {
        type: 'object',
        required: ['percent'],
        properties: {
          percent: { type: 'number', description: 'volume 0-100' },
        },
      },
    },
  },
  run: safe(async ({ percent }) => {
    return await NativeModules.DeviceToolsModule.setVolume(Number(percent));
  }),
};

const notifyTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'notify',
      description: 'Post a local notification to the phone.',
      parameters: {
        type: 'object',
        required: ['title', 'body'],
        properties: {
          title: { type: 'string', description: 'notification title' },
          body: { type: 'string', description: 'notification text' },
        },
      },
    },
  },
  run: safe(async ({ title, body }) => {
    if (Number(Platform.Version) >= 33) {
      await PermissionsAndroid.request(
        'android.permission.POST_NOTIFICATIONS' as any,
      );
    }
    return await NativeModules.DeviceToolsModule.notify(
      String(title ?? ''),
      String(body ?? ''),
    );
  }),
};

const writeCalendarTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'add_calendar_event',
      description:
        'Open the calendar app to add an event (the user confirms to save).',
      parameters: {
        type: 'object',
        required: ['title', 'start'],
        properties: {
          title: { type: 'string', description: 'event title' },
          start: {
            type: 'string',
            description: "start time, format 'YYYY-MM-DD HH:mm'",
          },
          durationMinutes: {
            type: 'number',
            description: 'length in minutes (default 60)',
          },
          location: { type: 'string', description: 'optional location' },
        },
      },
    },
  },
  run: safe(async ({ title, start, durationMinutes, location }) => {
    return await NativeModules.DeviceToolsModule.addCalendarEvent(
      String(title),
      String(start),
      Number(durationMinutes ?? 60),
      String(location ?? ''),
    );
  }),
};

const readCalendarTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'read_calendar',
      description: 'List upcoming calendar events within the next N days.',
      parameters: {
        type: 'object',
        properties: {
          days: {
            type: 'number',
            description: 'how many days ahead (default 7)',
          },
        },
      },
    },
  },
  run: safe(async ({ days }) => {
    await requirePermission(
      PermissionsAndroid.PERMISSIONS.READ_CALENDAR,
      'calendar',
    );
    return await NativeModules.DeviceToolsModule.readCalendar(
      Number(days ?? 7),
    );
  }),
};

const createContactTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'create_contact',
      description:
        'Open the contact editor prefilled to add a new contact (the user confirms to save).',
      parameters: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'contact name' },
          phone: { type: 'string', description: 'phone number' },
          email: { type: 'string', description: 'email address' },
        },
      },
    },
  },
  run: safe(async ({ name, phone, email }) => {
    return await NativeModules.DeviceToolsModule.createContact(
      String(name),
      String(phone ?? ''),
      String(email ?? ''),
    );
  }),
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
  setTimerTool,
  callPhoneTool,
  sendSmsTool,
  writeCalendarTool,
  clipboardSetTool,
  clipboardGetTool,
  deviceStatusTool,
  locationTool,
  contactsTool,
  readCalendarTool,
  createContactTool,
  flashlightTool,
  vibrateTool,
  setVolumeTool,
  notifyTool,
];
export const toolMap = new Map(tools.map(t => [t.definition.function.name, t]));
export const toolDefs = tools.map(t => t.definition);
