import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Agent, fetch } from "undici";
import { domainToUnicode } from "url";
import { wikify } from "./wikificator";

// ---------------- Preview state ----------------
let panel: vscode.WebviewPanel | undefined;
let lastUpdateTimer: NodeJS.Timeout | undefined;
let isRendering = false;
let pendingRender = false;
let syncTerminal: vscode.Terminal | undefined;
let syncTerminalAuth: Auth | null = null;

// ---------------- Auth (ephemeral) ----------------
type Auth = { username: string; password: string; domain: string };
let sessionAuth: Auth | null = null;
let sessionSyncSummary: string | null = null;

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("mws.openPreview", () =>
      openPreview(context)
    ),
    vscode.commands.registerCommand("mws.setAuthString", setAuthString),
    vscode.commands.registerCommand("mws.setSyncSummary", setSyncSummary),
    vscode.commands.registerCommand("mws.syncCurrent", () =>
      syncCurrent(context)
    ),
    vscode.commands.registerCommand("mws.fixWikiText", fixWikiText)
  );
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((t) => {
      if (t === syncTerminal) {
        syncTerminal = undefined;
        syncTerminalAuth = null;
      }
    })
  );
}

export function deactivate() {}

type MwsConfig = {
  api_url?: string;
  username?: string | null;
  user_agent?: string | null;
  repo_root?: string | null;
  skin_css?: string[] | null;
};

// ---------------- Preview ----------------
async function openPreview(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage("Нет активного редактора.");
    return;
  }

  if (!panel) {
    panel = vscode.window.createWebviewPanel(
      "mwsPreview",
      "MWS Preview",
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );
    panel.iconPath = vscode.Uri.file(
      path.join(context.extensionPath, "media", "icon-preview.svg")
    );
    panel.onDidDispose(() => (panel = undefined));
  }

  const cfg = vscode.workspace.getConfiguration("mws");
  const debounceMs = cfg.get<number>("debounceMs") ?? 10000;
  const userBg = cfg.get<string>("background") ?? "#ffffff";
  const hideEdit = cfg.get<boolean>("hideEditLinks") ?? true;
  const insecureTLS = cfg.get<boolean>("insecureTLS") ?? false;

  const update = async () => {
    if (isRendering) {
      pendingRender = true;
      return;
    }
    isRendering = true;
    try {
      const doc = editor.document;
      const text = doc.getText();
      const { apiUrl, ua, origin, baseDir, localStyle, externalCss } =
        await resolveEnv(doc.uri);
      if (!apiUrl) {
        panel!.webview.html = wrapHTML(
          `<p style="color:#c00">Не задан api_url (ни в .mws/config.json, ни в глобальной настройке mws.apiUrl).</p>`,
          { bg: userBg }
        );
        return;
      }
      const { html: htmlRaw, modules } = await renderWithParse(
        apiUrl,
        text,
        "Sandbox",
        ua,
        hideEdit,
        insecureTLS
      );
      const htmlFixed = rewriteResourceUrls(htmlRaw, origin, baseDir);
      const mwStyles = modules.length
        ? [
            `${origin}${baseDir}load.php?modules=${encodeURIComponent(
              modules.join("|")
            )}&only=styles`,
          ]
        : [];

      panel!.webview.html = wrapHTML(htmlFixed, {
        origin,
        baseDir,
        bg: userBg,
        localStyle,
        externalCss,
        mwStyles,
        hideEdit,
      });
    } catch (e: any) {
      panel!.webview.html = wrapHTML(
        `<pre>Render error:\n${escapeHtml(e?.message || String(e))}</pre>`,
        { bg: userBg }
      );
    } finally {
      isRendering = false;
      if (pendingRender) {
        pendingRender = false;
        schedule();
      }
    }
  };

  function schedule() {
    clearTimeout(lastUpdateTimer);
    lastUpdateTimer = setTimeout(() => update(), debounceMs);
  }

  // Первичный рендер
  update();

  // Изменения текстa → отложенный запуск
  const onChange = vscode.workspace.onDidChangeTextDocument(
    (ev: vscode.TextDocumentChangeEvent) => {
      if (ev.document === editor.document) schedule();
    }
  );
  const onSave = vscode.workspace.onDidSaveTextDocument(
    (doc: vscode.TextDocument) => {
      if (doc === editor.document) schedule();
    }
  );
  context.subscriptions.push(onChange, onSave);
}

async function resolveEnv(uri: vscode.Uri): Promise<{
  apiUrl: string | null;
  ua: string;
  origin: string;
  baseDir: string;
  localStyle: string;
  externalCss: string[];
}> {
  const localConfig = await findLocalConfig(uri);
  let apiUrl: string | null = null;
  let ua = "mws-prototype/0.0.3";
  let externalCss: string[] = [];
  if (localConfig?.api_url) {
    apiUrl = normalizeApi(localConfig.api_url);
    ua = localConfig.user_agent || ua;
    externalCss = Array.isArray(localConfig.skin_css)
      ? localConfig.skin_css
      : [];
  } else {
    const cfg = vscode.workspace.getConfiguration("mws");
    apiUrl = cfg.get<string>("apiUrl") || null;
    apiUrl = apiUrl ? normalizeApi(apiUrl) : null;
  }
  const { origin, baseDir } = computeOrigins(apiUrl || "");
  const localStyle = await findLocalStyle(uri);
  return { apiUrl, ua, origin, baseDir, localStyle, externalCss };
}

function normalizeApi(url: string): string {
  return url;
}

export function computeOrigins(endpoint: string): { origin: string; baseDir: string } {
  try {
    const trimmed = endpoint.replace(/\/+$/, "");
    const u = new URL(
      trimmed.match(/^https?:\/\//) ? trimmed : `https://${trimmed}`
    );
    const pathname = u.pathname;
    let baseDir = pathname;
    if (/api\.php$/i.test(pathname))
      baseDir = pathname.substring(0, pathname.lastIndexOf("/") + 1);
    else if (!baseDir.endsWith("/")) baseDir += "/";
    const origin = `${u.protocol}//${u.host}`;
    return { origin, baseDir };
  } catch {
    return { origin: "", baseDir: "/" };
  }
}

async function findLocalConfig(uri: vscode.Uri): Promise<MwsConfig | null> {
  let dir = path.dirname(uri.fsPath);
  const seen = new Set<string>();
  while (true) {
    if (seen.has(dir)) break;
    seen.add(dir);
    const candidateDir = path.join(dir, ".mws");
    const candidateFile = path.join(candidateDir, "config.json");
    try {
      const statDir = await fs.promises.stat(candidateDir).catch(() => null);
      if (statDir && statDir.isDirectory()) {
        const statFile = await fs.promises
          .stat(candidateFile)
          .catch(() => null);
        if (statFile && statFile.isFile()) {
          const raw = await fs.promises.readFile(candidateFile, "utf8");
          try {
            return JSON.parse(raw) as MwsConfig;
          } catch {}
        }
      }
    } catch {}
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function findLocalStyle(uri: vscode.Uri): Promise<string> {
  let dir = path.dirname(uri.fsPath);
  const seen = new Set<string>();
  while (true) {
    if (seen.has(dir)) break;
    seen.add(dir);
    const f = path.join(dir, ".mws", "style.css");
    try {
      const stat = await fs.promises.stat(f).catch(() => null);
      if (stat && stat.isFile()) return await fs.promises.readFile(f, "utf8");
    } catch {}
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "";
}

async function renderWithParse(
  endpoint: string,
  wikitext: string,
  title: string,
  userAgent: string,
  hideEdit: boolean,
  insecureTLS: boolean
): Promise<{ html: string; modules: string[] }> {
  const base = endpoint.replace(/\/+$/, "");
  const url = /api\.php/i.test(base)
    ? `${base}?action=parse&format=json&prop=text|modulestyles&disablelimitreport=1&contentmodel=wikitext${
        hideEdit ? "&disableeditsection=1" : ""
      }`
    : `${base}/api.php?action=parse&format=json&prop=text|modulestyles&disablelimitreport=1&contentmodel=wikitext${
        hideEdit ? "&disableeditsection=1" : ""
      }`;

  const body = new URLSearchParams({ text: wikitext, title });

  const dispatcher = insecureTLS
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : undefined;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": userAgent || "mws-prototype/0.0.3",
    },
    body,
    dispatcher,
  } as any);

  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = (await res.json()) as any;
  const html = data?.parse?.text?.["*"];
  if (!html) throw new Error("Empty parse response");
  const modules = (data?.parse?.modulestyles || [])
    .map((m: any) => m?.["*"] ?? m)
    .filter((m: any): m is string => typeof m === "string");
  return { html: String(html), modules };
}

function rewriteResourceUrls(
  html: string,
  origin: string,
  baseDir: string
): string {
  // protocol-relative -> add scheme from origin
  html = html.replace(
    /(src|href)=("|\')\/\/([^"\']+)/gi,
    (_m, attr, q, rest) =>
      `${attr}=${q}${origin.split(":")[0]}:${"//"}${rest}${q}`
  );
  // root-relative -> prefix origin
  html = html.replace(
    /(src|href)=("|\')\/([^"\']*)/gi,
    (_m, attr, q, rest) => `${attr}=${q}${origin}/${rest}`
  );
  // bare relative (not starting with '/', 'http', 'data:', 'mailto:', 'javascript:', '#')
  html = html.replace(
    /(src|href)=("|\')((?!https?:|data:|mailto:|javascript:|#)[^"\'\/][^"\']*)/gi,
    (_m, attr, q, rel) => `${attr}=${q}${origin}${baseDir}${rel}${q}`
  );
  return html;
}

function wrapHTML(
  inner: string,
  opts: {
    origin?: string;
    baseDir?: string;
    bg?: string;
    localStyle?: string;
    externalCss?: string[];
    mwStyles?: string[];
    hideEdit?: boolean;
  } = {}
) {
  const {
    origin,
    baseDir,
    bg = "#ffffff",
    localStyle = "",
    externalCss = [],
    mwStyles = [],
    hideEdit = true,
  } = opts;
  const baseTag = origin && baseDir ? `<base href="${origin}${baseDir}">` : "";
  const externalLinks = (externalCss || [])
    .map((u) => `<link rel="stylesheet" href="${u}">`)
    .join("\n");
  const mwStyleLinks = (mwStyles || [])
    .map((u) => `<link rel="stylesheet" href="${u}">`)
    .join("\n");
  const editHideCss = hideEdit
    ? `.mw-editsection{ display:none !important; }`
    : "";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  ${baseTag}
  ${externalLinks}
  ${mwStyleLinks}
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline' https:; font-src https: data:;">
  <style>
    html, body { padding: 0; margin: 0; background: ${bg}; }
    body { padding: 12px; line-height: 1.6; font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #111; }
    table { border-collapse: collapse; }
    table, th, td { border: 1px solid rgba(127,127,127,.3); }
    th, td { padding: 4px 6px; }
    img { max-width: 100%; height: auto; }
    pre { white-space: pre-wrap; }
    .thumb, .thumbinner, .thumbimage { max-width: 100%; }
    .floatright, .tright { float: right; margin: 0 0 0.5em 1em; }
    .floatleft, .tleft { float: left; margin: 0 1em 0.5em 0; }
    ${editHideCss}
    ${localStyle || ""}
  </style>
</head>
<body>${inner}</body>
</html>`;
}

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ]!)
  );
}

// ---------------- Auth & Sync ----------------
async function setAuthString() {
  const input = await vscode.window.showInputBox({
    prompt: "Строка авторизации для MediaWiki (user[@domain]:password)",
    password: true,
    ignoreFocusOut: true,
    placeHolder: "user[@domain]:password",
  });
  if (!input) return;
  const m = input.match(/^([^:@]+)(?:@([^:]+))?:(.+)$/);
  if (!m) {
    vscode.window.showErrorMessage(
      "Неверный формат. Ожидается user[@domain]:password"
    );
    return;
  }
  const [, user, domain = "", password] = m;
  sessionAuth = { username: user, domain, password };
  vscode.window.showInformationMessage(
    `Авторизация сохранена в сессии: ${user}${domain ? "@" + domain : ""}`
  );
}

async function setSyncSummary() {
  const input = await vscode.window.showInputBox({
    prompt: "Комментарий к правке (sync summary)",
    ignoreFocusOut: true,
    placeHolder: "небольшие правки",
    value: sessionSyncSummary || "",
  });
  // Allow empty summary, but not cancellation (undefined)
  if (input !== undefined) {
    sessionSyncSummary = input;
    vscode.window.showInformationMessage(
      `Комментарий для синка сохранен в сессии.`
    );
  }
}

function interpolateCommand(
  tpl: string,
  doc: vscode.TextDocument
): { cmd: string; cwd: string } {
  const file = doc.fileName;
  const dirname = path.dirname(file);
  const basename = path.basename(file);
  const ext = path.extname(file);
  const basenameNoExt = basename.slice(0, basename.length - ext.length);
  const ws =
    vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath || dirname;

  const map: Record<string, string> = {
    "${file}": file,
    "${fileDirname}": dirname,
    "${fileBasename}": basename,
    "${fileExtname}": ext,
    "${fileBasenameNoExtension}": basenameNoExt,
    "${workspaceFolder}": ws,
  };
  let cmd = tpl;
  for (const [k, v] of Object.entries(map)) cmd = cmd.split(k).join(v);
  return { cmd, cwd: dirname };
}

/**
 * Декодирует строку, содержащую специальное URL-кодирование MediaWiki,
 * используемое для заголовков секций (якорей).
 *
 * @param encodedFragment Строка якоря из MediaWiki (например, ".E2.84.9617" или "Тест_с_пробелами")
 * @returns Декодированная строка (например, "№17" или "Тест с пробелами")
 */
// Плейсхолдер из области Private Use Area (гарантированно не используется в тексте)
const SEMVER_PLACEHOLDER = '\u{E000}';

function decodeMwFragment(encodedFragment: string): string {
    if (!encodedFragment) {
        return '';
    }

    // 1. Заменяем все подчеркивания (_) на пробелы.
    let tempFragment = encodedFragment.replace(/_/g, ' ');

    // 2. ЭВРИСТИКА: Прячем числа, похожие на semver (X.Y или X.Y.Z)
    // Цель: заменить точку `.` в этих числах на плейсхолдер, чтобы избежать
    // ее преобразования в `%2E` во время Шага 3.

    // Регулярное выражение для поиска `.` между двумя цифрами: `(\d)\.(\d)`
    // или более сложное: цифра, точка, цифра, (опционально) точка, цифра.
    // Мы упростим до поиска точки, окруженной цифрами.
    // Важно: мы ищем точку, которая НЕ закодирована как .XX (т.е. обычную точку)

    let protectedSemver1 = tempFragment.replace(
        /([^\d])(\d)\.(\d).(\d\d?)/g, 
        (match, p1, p2, p3, p4) => p1 + p2 + SEMVER_PLACEHOLDER + p3 + SEMVER_PLACEHOLDER + p4
    );

    let protectedSemver2 = protectedSemver1.replace(
        /([^[0-F]])(\d)\.(\d\d?)([^[0-F]])?/g, 
        (match, p1, p2, p3, p4) => p1 + p2 + SEMVER_PLACEHOLDER + p3 + p4
    );

    // 3. Заменяем все последовательности ".XX" на "%XX".
    // Теперь это безопасно: `.XX` будут только кодировками символов (кириллица, скобки),
    // а точки в числах уже заменены плейсхолдером.
    let percentEncodedFragment = protectedSemver2.replace(
        /\.([0-9A-Fa-f]{2})/g, 
        (match, p1) => `%${p1}`
    );

    // 4. Используем decodeURIComponent для декодирования UTF-8 байтов.
    try {
        let result0 = decodeURIComponent(percentEncodedFragment);
        
        // 5. Восстанавливаем точку в semver-подобных числах
        let result = result0.replace(
            new RegExp(SEMVER_PLACEHOLDER, 'g'), 
            '.'
        );
        
        return result;
    } catch (e) {
        console.error(`Ошибка декодирования MediaWiki якоря: ${encodedFragment}`, e);
        return encodedFragment;
    }
}

// function decodeMwFragment(fragment: string): string {
//   // In MW fragments, underscores are used for spaces.
//   // We'll convert them to %20 to be handled by decodeURIComponent.
//   let s = fragment.replace(/_/g, "%20");

//   // Protect dots inside numbers (e.g. in "2.6.16").
//   const protectedPlaceholder = "__DOT_PROTECTED__";
//   s = s.replace(/(?<=\d)\.(?=\d)/g, protectedPlaceholder);

//   // Convert dot-encoded chars to percent-encoded.
//   s = s.replace(/\.([0-9a-fA-F]{2})/g, "%$1");

//   // Unprotect dots.
//   s = s.replace(new RegExp(protectedPlaceholder, "g"), ".");

//   try {
//     return decodeURIComponent(s);
//   } catch (e) {
//     // If decoding fails, it might be because some parts were not encoded correctly.
//     // The original string is a safer fallback than a partially decoded one.
//     return fragment;
//   }
// }

export function fixWikiTextLogic(
  text: string,
  origin: string,
  baseDir: string,
  options: { fixTypography: boolean }
): string {
  let metadataBlock = "";
  let content = text;

  const metadataEndMarker = "END_MWS_METADATA -->";
  const metadataEndIndex = text.indexOf(metadataEndMarker);

  if (metadataEndIndex !== -1 && text.trim().startsWith("<!--")) {
    const endOfBlock = metadataEndIndex + metadataEndMarker.length;
    metadataBlock = text.substring(0, endOfBlock);
    content = text.substring(endOfBlock);
  }

  let newContent = content;

  // Rule: Decode Punycode URLs
  newContent = newContent.replace(
    /(https?:\/\/)([^/?#\s]+)/g,
    (match, protocol, hostname) => {
      try {
        const unicodeHostname = domainToUnicode(hostname);
        return protocol + unicodeHostname;
      } catch (e) {
        return match;
      }
    }
  );

  // Rule 1: Convert absolute URLs to internal links.

  // Regex for bracketed links: [http://... text] or [text http://...]
  const bracketedLinkRegex = /\[(.+?)\]/g;
  newContent = newContent.replace(bracketedLinkRegex, (match, content) => {
    const urlMatch = content.match(/(https?:\/\/[^\]\s]+)/);
    if (!urlMatch) {
      return match;
    }
    const url = urlMatch[0];
    if (!url.startsWith(origin)) {
      return match; // Quick check
    }

    const urlIndex = content.indexOf(url);
    const textBefore = content.substring(0, urlIndex);
    const textAfter = content.substring(urlIndex + url.length);

    try {
      const urlObj = new URL(url);
      if (urlObj.origin !== origin) {
        return match;
      }

      const linkTextRaw = (textBefore + textAfter).trim();
      const linkText = linkTextRaw ? linkTextRaw : null;

      // With query params -> {{fullurl:...}}
      if (urlObj.search) {
        const params = urlObj.searchParams;
        const title = params.get("title");
        if (!title) return match; // Cannot handle if no title param

        params.delete("title");
        const otherParams = Array.from(params.entries()).map(
          ([k, v]) => `${k}=${v.replace(/^"|"$/g, "")}`
        );
        const fullUrlParams = [title, ...otherParams].join("|");
        const linkContent = linkText ? ` ${linkText}` : "";
        return `[{{fullurl:${fullUrlParams}}}${linkContent}]`;
      }

      // Without query params -> [[...]]
      let pageTitlePath = urlObj.pathname;
      if (baseDir !== "/" && pageTitlePath.startsWith(baseDir)) {
        pageTitlePath = pageTitlePath.substring(baseDir.length);
      } else if (pageTitlePath.startsWith("/")) {
        pageTitlePath = pageTitlePath.substring(1);
      }

      if (pageTitlePath.includes("img_auth.php")) {
        const parts = pageTitlePath.split('/');
        const filename = parts.pop();
        if (filename) {
          pageTitlePath = `File:${filename}`;
        }
      }

      const pathWithFragment = pageTitlePath + urlObj.hash;
      const [path, fragment] = pathWithFragment.split("#");

      let pageTitle = decodeURIComponent(path).replace(/_/g, " ");

      if (fragment) {
        if (pageTitle.match(/^(File|Файл):/i) && pageTitle.toLowerCase().endsWith('.pdf') && fragment.match(/^page=\d+$/)) {
          pageTitle += "|" + fragment;
        } else {
          pageTitle += "#" + decodeMwFragment(fragment);
        }
      }

      const needsColon =
        /^(Category|Категория|Template|Шаблон):/i.test(pageTitle);
      const colon = needsColon ? ":" : "";

      if (linkText) {
        return `[[${colon}${pageTitle}|${linkText}]]`;
      } else {
        return `[[${colon}${pageTitle}]]`;
      }
    } catch (e) {
      return match;
    }
  });

  // Regex for bare URLs.
  // It should not match URLs inside `[[...]]` or `[...]` or `|...=http...`.
  const bareLinkRegex = /(?<![\[=|])(https?:\/\/[^\s|\]}]+)/g;
  newContent = newContent.replace(bareLinkRegex, (match, url) => {
    if (!url.startsWith(origin)) {
      return match;
    }
    try {
      const urlObj = new URL(url);
      if (urlObj.origin !== origin) {
        return match;
      }

      // With query params -> {{fullurl:...}}
      if (urlObj.search) {
        const params = urlObj.searchParams;
        const title = params.get("title");
        if (!title) return match;

        params.delete("title");
        const otherParams = Array.from(params.entries()).map(
          ([k, v]) => `${k}=${v.replace(/^"|"$/g, "")}`
        );
        const fullUrlParams = [title, ...otherParams].join("|");
        return `{{fullurl:${fullUrlParams}}}`;
      }

      // Without query params -> [[...]]
      let pageTitlePath = urlObj.pathname;
      if (baseDir !== "/" && pageTitlePath.startsWith(baseDir)) {
        pageTitlePath = pageTitlePath.substring(baseDir.length);
      } else if (pageTitlePath.startsWith("/")) {
        pageTitlePath = pageTitlePath.substring(1);
      }

      if (pageTitlePath.includes("img_auth.php")) {
        const parts = pageTitlePath.split('/');
        const filename = parts.pop();
        if (filename) {
          pageTitlePath = `File:${filename}`;
        }
      }

      const pathWithFragment = pageTitlePath + urlObj.hash;
      const [path, fragment] = pathWithFragment.split("#");

      let pageTitle = decodeURIComponent(path).replace(/_/g, " ");

      if (fragment) {
        if (pageTitle.match(/^(File|Файл):/i) && pageTitle.toLowerCase().endsWith('.pdf') && fragment.match(/^page=\d+$/)) {
          pageTitle += "|" + fragment;
        } else {
          pageTitle += "#" + decodeMwFragment(fragment);
        }
      }

      const needsColon =
        /^(Category|Категория|Template|Шаблон):/i.test(pageTitle);
      const colon = needsColon ? ":" : "";

      return `[[${colon}${pageTitle}]]`;
    } catch (e) {
      return match;
    }
  });

  let newText = metadataBlock + newContent;

  if (options.fixTypography) {
    newText = wikify(newText);
  }

  return newText;
}

async function fixWikiText() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage("Нет активного редактора.");
    return;
  }
  if (editor.document.languageId !== "wikitext") {
    vscode.window.showInformationMessage(
      "Команда работает только для wikitext-файлов."
    );
    return;
  }

  const { origin, baseDir } = await resolveEnv(editor.document.uri);
  if (!origin) {
    vscode.window.showErrorMessage(
      "Не удалось определить origin для текущего файла. Проверьте конфигурацию."
    );
    return;
  }

  const cfg = vscode.workspace.getConfiguration("mws");
  const fixTypography = cfg.get<boolean>("fixTypography") ?? true;

  const text = editor.document.getText();
  const newText = fixWikiTextLogic(text, origin, baseDir, { fixTypography });

  if (newText !== text) {
    const fullRange = new vscode.Range(
      editor.document.positionAt(0),
      editor.document.positionAt(text.length)
    );
    editor.edit((editBuilder) => {
      editBuilder.replace(fullRange, newText);
    });
    vscode.window.showInformationMessage("Вики-текст исправлен.");
  } else {
    vscode.window.showInformationMessage("Не найдено ничего для исправления.");
  }
}

async function syncCurrent(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage("Нет активного редактора.");
    return;
  }
  if (!sessionAuth) {
    await setAuthString();
    if (!sessionAuth) return; // User cancelled auth prompt
  }

  if (sessionSyncSummary === null) {
    await setSyncSummary();
    if (sessionSyncSummary === null) return; // User cancelled summary prompt
  }

  const cfg = vscode.workspace.getConfiguration("mws");
  let tpl = cfg.get<string>("sync.command") || 'mws push "${file}"';
  if (sessionSyncSummary) {
    tpl += ` --summary ${shellQuote(sessionSyncSummary)}`;
  }
  const { cmd, cwd } = interpolateCommand(tpl, editor.document);

  const authChanged =
    !syncTerminal ||
    !syncTerminalAuth ||
    JSON.stringify(sessionAuth) !== JSON.stringify(syncTerminalAuth);

  if (authChanged) {
    if (syncTerminal) {
      syncTerminal.dispose();
    }
    const env = {
      ...process.env,
      MWS_USERNAME: sessionAuth!.username,
      MWS_PASSWORD: sessionAuth!.password,
      MWS_DOMAIN: sessionAuth!.domain || "",
    };
    syncTerminal = vscode.window.createTerminal({ name: "MWS Sync", cwd, env });
    syncTerminalAuth = sessionAuth;
  }

  syncTerminal!.show();

  // If we reused the terminal, its CWD might be from a different file.
  if (!authChanged) {
    syncTerminal!.sendText(`cd ${shellQuote(cwd)}`, true);
  }

  // Run the actual command
  syncTerminal!.sendText(cmd, true);
}

function shellQuote(p: string) {
  // минимально для bash/zsh/fish (под Linux/macOS). Для Windows можно расширить при желании.
  return `'${p.replace(/'/g, `'\\''`)}'`;
}
