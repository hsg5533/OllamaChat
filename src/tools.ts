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

const NO_PARAMS = { type: 'object', properties: {} };
const PATH_PARAM = {
  type: 'object',
  required: ['path'],
  properties: {
    path: { type: 'string', description: "file name, e.g. 'notes.txt'" },
  },
};

function tool(
  name: string,
  description: string,
  parameters: Record<string, any>,
  run: (args: Record<string, any>) => Promise<string>,
) {
  return {
    definition: {
      type: 'function',
      function: { name, description, parameters },
    },
    run: async (args: Record<string, any>) => {
      try {
        return await run(args);
      } catch (e) {
        if (e instanceof Error) return `error: ${e.message}`;
      }
      return '';
    },
  };
}

async function requirePermission(
  perm: Parameters<typeof PermissionsAndroid.request>[0],
  label: string,
) {
  const granted = await PermissionsAndroid.request(perm);
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error(`${label} permission denied`);
  }
}

const DOWNLOAD = RNFS.DownloadDirectoryPath;

function downloadPath(path: string) {
  const name = path.replace(/^\/+/, '');
  if (!name || name.includes('..') || name.includes('/')) {
    throw new Error(`invalid file name: ${path}`);
  }
  return `${DOWNLOAD}/${name}`;
}

const listFileTool = tool(
  'list_files',
  "List files in the phone's Download folder.",
  NO_PARAMS,
  async () => {
    const entries = await RNFS.readDir(DOWNLOAD);
    return (
      entries
        .map((e: RNFS.ReadDirResItemT) =>
          e.isDirectory() ? `${e.name}/` : e.name,
        )
        .join('\n') || '(empty)'
    );
  },
);

const readFileTool = tool(
  'read_file',
  "Read a text file from the phone's Download folder. Returns up to 4000 chars.",
  PATH_PARAM,
  async ({ path }) => {
    const content = await RNFS.readFile(downloadPath(path), 'utf8');
    return content.slice(0, 4000);
  },
);

const writeFileTool = tool(
  'write_file',
  "Write text to a file in the phone's Download folder. Overwrites if it exists.",
  {
    type: 'object',
    required: ['path', 'content'],
    properties: {
      path: { type: 'string', description: "file name, e.g. 'notes.txt'" },
      content: { type: 'string', description: 'text to write' },
    },
  },
  async ({ path, content }) => {
    await RNFS.writeFile(downloadPath(path), String(content ?? ''), 'utf8');
    return `saved to Download/${path}`;
  },
);

function htmlToText(html: string) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(
      /<(script|style|noscript|iframe|svg|canvas)[^>]*>[\s\S]*?<\/\1>/gi,
      ' ',
    )
    .replace(/<(br|hr)\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(parseInt(code, 16)),
    )
    .replace(/\s+/g, ' ')
    .trim();
}

const fetchUrlTool = tool(
  'fetch_url',
  'Fetch a web page and return its readable text (HTML stripped). Use this to read or summarize a website.',
  {
    type: 'object',
    required: ['url'],
    properties: {
      url: {
        type: 'string',
        description: 'page URL, e.g. https://example.com',
      },
    },
  },
  async ({ url }) => {
    const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const res = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) {
      return `error: HTTP ${res.status}`;
    }
    const text = htmlToText(await res.text());
    return text.slice(0, 6000) || '(no readable text found)';
  },
);

const webSearchTool = tool(
  'web_search',
  "Search the web and return result titles, snippets, and links. Use this whenever you don't know something or need current/up-to-date info.",
  {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', description: 'search query' },
    },
  },
  async ({ query }) => {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } },
    );
    if (!res.ok) {
      return `error: HTTP ${res.status}`;
    }
    const text = htmlToText(await res.text());
    return text.slice(0, 4000) || '(no results)';
  },
);

function cleanNumber(n: string): string {
  return String(n).replace(/[^\d+*#]/g, '');
}

const callPhoneTool = tool(
  'call_phone',
  'Open the phone dialer with a number ready to call. The user must press call.',
  {
    type: 'object',
    required: ['number'],
    properties: {
      number: {
        type: 'string',
        description: 'phone number, e.g. 010-1234-5678',
      },
    },
  },
  async ({ number }) => {
    await Linking.openURL(`tel:${cleanNumber(number)}`);
    return `opened dialer for ${number}`;
  },
);

const sendSmsTool = tool(
  'send_sms',
  'Open the SMS app with the recipient and message prefilled. The user must press send.',
  {
    type: 'object',
    required: ['number', 'message'],
    properties: {
      number: { type: 'string', description: 'recipient phone number' },
      message: { type: 'string', description: 'message text' },
    },
  },
  async ({ number, message }) => {
    const body = encodeURIComponent(String(message ?? ''));
    await Linking.openURL(`sms:${cleanNumber(number)}?body=${body}`);
    return `opened SMS composer for ${number}`;
  },
);

const weatherTool = tool(
  'get_weather',
  'Get the current weather for a city.',
  {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', description: 'city name, e.g. Seoul' },
    },
  },
  async ({ city }) => {
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
  },
);

const openUrlTool = tool(
  'open_url',
  'Open a URL in the browser or its app.',
  {
    type: 'object',
    required: ['url'],
    properties: { url: { type: 'string', description: 'URL to open' } },
  },
  async ({ url }) => {
    const target = /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`;
    await Linking.openURL(target);
    return `opened ${target}`;
  },
);

const openMapTool = tool(
  'open_map',
  'Open a place or address in the maps app.',
  {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', description: 'place or address' },
    },
  },
  async ({ query }) => {
    await Linking.openURL(`geo:0,0?q=${encodeURIComponent(query)}`);
    return `opened map for ${query}`;
  },
);

const sendEmailTool = tool(
  'send_email',
  'Open the email app with a draft prefilled. The user must press send.',
  {
    type: 'object',
    required: ['to'],
    properties: {
      to: { type: 'string', description: 'recipient email' },
      subject: { type: 'string', description: 'subject' },
      body: { type: 'string', description: 'email body' },
    },
  },
  async ({ to, subject, body }) => {
    const q = `subject=${encodeURIComponent(
      subject ?? '',
    )}&body=${encodeURIComponent(body ?? '')}`;
    await Linking.openURL(`mailto:${to}?${q}`);
    return `opened email draft to ${to}`;
  },
);

const shareTextTool = tool(
  'share_text',
  'Open the system share sheet with some text.',
  {
    type: 'object',
    required: ['text'],
    properties: { text: { type: 'string', description: 'text to share' } },
  },
  async ({ text }) => {
    await Share.share({ message: String(text ?? '') });
    return 'opened share sheet';
  },
);

const setAlarmTool = tool(
  'set_alarm',
  "Set an alarm in the phone's clock app.",
  {
    type: 'object',
    required: ['hour', 'minute'],
    properties: {
      hour: { type: 'number', description: 'hour 0-23' },
      minute: { type: 'number', description: 'minute 0-59' },
      message: { type: 'string', description: 'alarm label' },
    },
  },
  async ({ hour, minute, message }) => {
    await NativeModules.AlarmModule.setAlarm(
      Number(hour),
      Number(minute),
      String(message ?? 'Alarm'),
    );
    return `alarm set for ${hour}:${String(minute).padStart(2, '0')}`;
  },
);

const deleteFileTool = tool(
  'delete_file',
  "Delete a file from the phone's Download folder.",
  PATH_PARAM,
  async ({ path }) => {
    await RNFS.unlink(downloadPath(path));
    return `deleted ${path}`;
  },
);

const appendFileTool = tool(
  'append_file',
  'Append text to a file in the Download folder (creates it if missing).',
  {
    type: 'object',
    required: ['path', 'content'],
    properties: {
      path: { type: 'string', description: "file name, e.g. 'log.txt'" },
      content: { type: 'string', description: 'text to append' },
    },
  },
  async ({ path, content }) => {
    await RNFS.appendFile(downloadPath(path), String(content ?? ''), 'utf8');
    return `appended to ${path}`;
  },
);

const fileExistsTool = tool(
  'file_exists',
  'Check whether a file exists in the Download folder.',
  PATH_PARAM,
  async ({ path }) => {
    const exists = await RNFS.exists(downloadPath(path));
    return exists ? 'yes' : 'no';
  },
);

const clipboardSetTool = tool(
  'clipboard_set',
  'Copy text to the clipboard.',
  {
    type: 'object',
    required: ['text'],
    properties: { text: { type: 'string', description: 'text to copy' } },
  },
  async ({ text }) => {
    Clipboard.setString(String(text ?? ''));
    return 'copied to clipboard';
  },
);

const clipboardGetTool = tool(
  'clipboard_get',
  'Read the current clipboard text.',
  NO_PARAMS,
  async () => {
    return (await Clipboard.getString()) || '(empty)';
  },
);

const deviceStatusTool = tool(
  'device_status',
  'Get phone status: battery level, charging, model, OS version.',
  NO_PARAMS,
  async () => {
    const battery = Math.round((await DeviceInfo.getBatteryLevel()) * 100);
    const charging = await DeviceInfo.isBatteryCharging();
    const model = DeviceInfo.getModel();
    const os = `${DeviceInfo.getSystemName()} ${DeviceInfo.getSystemVersion()}`;
    return `battery ${battery}%${
      charging ? ' (charging)' : ''
    }, ${model}, ${os}`;
  },
);

const locationTool = tool(
  'get_location',
  "Get the phone's current GPS coordinates (latitude, longitude).",
  NO_PARAMS,
  async () => {
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
  },
);

const contactsTool = tool(
  'find_contact',
  'Look up a contact by name and return their phone number(s).',
  {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', description: 'contact name to search' },
    },
  },
  async ({ name }) => {
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
  },
);

const setTimerTool = tool(
  'set_timer',
  "Start a countdown timer in the phone's clock app.",
  {
    type: 'object',
    required: ['seconds'],
    properties: {
      seconds: { type: 'number', description: 'duration in seconds' },
      message: { type: 'string', description: 'timer label' },
    },
  },
  async ({ seconds, message }) => {
    return await NativeModules.AlarmModule.setTimer(
      Number(seconds),
      String(message ?? 'Timer'),
    );
  },
);

const flashlightTool = tool(
  'flashlight',
  'Turn the phone flashlight on or off.',
  {
    type: 'object',
    required: ['on'],
    properties: {
      on: { type: 'boolean', description: 'true = on, false = off' },
    },
  },
  async ({ on }) => {
    return await NativeModules.DeviceToolsModule.flashlight(!!on);
  },
);

const vibrateTool = tool(
  'vibrate',
  'Vibrate the phone for a number of milliseconds.',
  {
    type: 'object',
    properties: {
      ms: { type: 'number', description: 'duration in ms (default 400)' },
    },
  },
  async ({ ms }) => {
    return await NativeModules.DeviceToolsModule.vibrate(Number(ms ?? 400));
  },
);

const setVolumeTool = tool(
  'set_volume',
  'Set the media volume (0-100%).',
  {
    type: 'object',
    required: ['percent'],
    properties: {
      percent: { type: 'number', description: 'volume 0-100' },
    },
  },
  async ({ percent }) => {
    return await NativeModules.DeviceToolsModule.setVolume(Number(percent));
  },
);

const notifyTool = tool(
  'notify',
  'Post a local notification to the phone.',
  {
    type: 'object',
    required: ['title', 'body'],
    properties: {
      title: { type: 'string', description: 'notification title' },
      body: { type: 'string', description: 'notification text' },
    },
  },
  async ({ title, body }) => {
    if (Number(Platform.Version) >= 33) {
      await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS');
    }
    return await NativeModules.DeviceToolsModule.notify(
      String(title ?? ''),
      String(body ?? ''),
    );
  },
);

const writeCalendarTool = tool(
  'add_calendar_event',
  'Open the calendar app to add an event (the user confirms to save).',
  {
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
  async ({ title, start, durationMinutes, location }) => {
    return await NativeModules.DeviceToolsModule.addCalendarEvent(
      String(title),
      String(start),
      Number(durationMinutes ?? 60),
      String(location ?? ''),
    );
  },
);

const readCalendarTool = tool(
  'read_calendar',
  'List upcoming calendar events within the next N days.',
  {
    type: 'object',
    properties: {
      days: {
        type: 'number',
        description: 'how many days ahead (default 7)',
      },
    },
  },
  async ({ days }) => {
    await requirePermission(
      PermissionsAndroid.PERMISSIONS.READ_CALENDAR,
      'calendar',
    );
    return await NativeModules.DeviceToolsModule.readCalendar(
      Number(days ?? 7),
    );
  },
);

const createContactTool = tool(
  'create_contact',
  'Open the contact editor prefilled to add a new contact (the user confirms to save).',
  {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', description: 'contact name' },
      phone: { type: 'string', description: 'phone number' },
      email: { type: 'string', description: 'email address' },
    },
  },
  async ({ name, phone, email }) => {
    return await NativeModules.DeviceToolsModule.createContact(
      String(name),
      String(phone ?? ''),
      String(email ?? ''),
    );
  },
);

const tools = [
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
