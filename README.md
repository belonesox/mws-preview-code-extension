# MWS Preview

The Problem:
- [MediaWiki](https://mediawiki.org) is a very popular and convenient engine for knowledge management systems 📚
    - both global 🌍
    - and local, intra-company ones 🏢
        - even for a small project, it is often convenient to set up MediaWiki:
            - the project can grow unexpectedly 📈
            - uniform interface for working with large knowledge bases in MediaWiki
        - easier to maintain link integrity 🔗
        - for customer-readers, reading is more important than writing. 👀
        - convenient to maintain «portals» 🧭
- The browser editing interface is simple, but heavily limited by the capabilities of a textarea or visual editor ✍️
    - due to textarea limitations, the markup language is not as good as it could be ⚠️
      - for example, you cannot use the `TAB` key to briskly manage indents, like in MD ⌨️
    - even with best Web Editors like CodeMirror/WikEd you have no professional IDE experience
- But professionals want to work with content effectively
    - like with flat markup files 📄
    - using a good editor 💻
        - such as VSCode
    - for speed ⚡
    - for voluminous articles
    - for mass operations — bulk editing, etc. 🧹
    - for collaborative *realtime* editing  🤝
        - using `code-server`

---

This is what this extension is designed for, allowing you to:
- ![](./docs/pics/icon-preview.png) preview even an unsaved `.mw` file in a preview pane, without publishing
  - taking into account all templates, extensions, and other settings of your MediaWiki
- ![](./docs/pics/icon-fix.png) fix markup and typography issues with a single «make it good» button
- ![](./docs/pics/icon-sync.png)
publish and synchronize MediaWiki files using [MWS](https://gitverse.ru/belonesox/mvs)
  - we recommend the [MWS](https://gitverse.ru/belonesox/mvs) command-line utility for polite synchronization (*three-way merge*, does not publish conflicts) in the spirit of simple Version Control Systems (like RCS, CVS).

# Installation
Install
- this extension
- the [wikitext](https://marketplace.visualstudio.com/items?itemName=RoweWilsonFrederiskHolme.wikitext) extension
    - the most up-to-date MediaWiki support
    - wikiparser is optional
- optionally, we recommend the [MWS](https://gitverse.ru/belonesox/mvs) utility for publishing
  - but you can use your own tools
  - or simply copy-paste the edited wiki content to MediaWiki and back

# Usage
Open a file containing wikitext.
Three buttons will appear.

![](./docs/pics/icon-preview.png) Preview MediaWiki markup directly in VS Code / code-server via remote MediaWiki
- uses the API method (`action=parse`), allowing it to work with ancient MediaWiki versions that do not yet have Parsoid.
- Searches for a local configuration in `.mws/config.json`, traversing up directories from the current file, looking for the `api_url` parameter.
  - such a file is created by the MWS system, but you can also create it manually if you don't use it.
    ```json
    {
      "api_url": "[https://0x1.tv](https://0x1.tv)"
    }
    ```
  > `api_url` can be either the full path to `api.php` or the base website URL (in this case, the extension will try to append `/w/api.php`).

- If not found, it uses the global `mws.apiUrl` setting.
- Live preview updates with debouncing.

![](./docs/pics/icon-fix.png) — fixes markup issues and, optionally, Russian typography with a single «make it good» button, integrating twenty years of experience and hundreds of heuristics from the [MediaWiki4intranet](https://wiki.4intra.net) project.

![](./docs/pics/icon-sync.png) Publishing and synchronizing a local `.mw` file, if it was checked out via MWS.
  - credentials for authorized publishing
    - will be prompted for on the first commit
    - format
      - `username password [domain]` (enter space-separated)
    - can be reset using the `mws.setAuthString` command
    - stored only in session memory
      - allows different wiki users to publish via a single code-server.
      - secure
        - > experimented with various keyrings, it's all a profanation if working on a shared code-server.
  - also, during the first commit, it will ask for an edit *summary* for the changes, and will use it subsequently
    - marks all wiki edits in the working session in a unified way
    - can be reset using the `mws.setSyncSummary` command

A normal *paste* works smartly, converting (as best it can) rich/html markup into wikitext.
- Headings, lists, bold, italics, etc.
- Tables are converted to HTML tables
  - for flexible support of coloring/formatting (it's easier to keep styles)
  - drops elements/attributes not supported by MediaWiki
    - class references, etc.
  - formatted in such a way that
    - the structure is visible
    - but the cell content starts at the beginning of the lines
      - making it easier to develop later as wiki content

## Development
- Checkout
- `npm install`
- `Run Extension` in the debugger.

- `./build-install-locally.sh` — build and install locally

There are tests (currently for the «fix everything» heuristics)
- `npm test`

## Configuration
- `mws.apiUrl`: string, default is `https://ru.wikipedia.org/w/api.php`
  - used if the local config `.mws/config.json` is not found
- `mws.debounceMs`: auto-update debounce in milliseconds
  - todo: switch to microseconds or seconds, there's no point in doing it faster than a couple of seconds.
- `mws.background`: Preview background color
  - a temporary hack due to the incompleteness of fetched styles
    - might result in unreadable text if pulling default styles from dark VSCode/code-server themes
- `mws.hideEditLinks`: Hide [edit] links in headings.
  - todo: probably needs to be hardcoded, no one ever needs them
- `mws.insecureTLS`: Allow insecure TLS connections, for example
  - for self-signed certificates in intranet wikis
  - or for standard http connections.
- `mws.fixTypography`: Fix typography as well during «Fix WikiText».
- `mws.sync.command`: publish command, configured by default to work with MWS
  - supports substitutions
    - `${file}`, `${workspaceFolder}`, `${summary}` …
  - easily adaptable to your publishing system

### Discussion and News
- Currently in Russian the ["FlippedClassroom" TG group](https://t.me/+lGrw4_WjS802ZmNi), «Knowledge Management» topic.
- New features log is in `./changelog.md`.

## License

MIT
