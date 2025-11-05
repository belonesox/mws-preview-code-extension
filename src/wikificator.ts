export function wikify(text: string): string {
  let txt = text;
  const hidden: string[] = [];

  function r(
    r1: RegExp,
    r2: string | ((substring: string, ...args: any[]) => string)
  ): void {
    txt = txt.replace(r1, r2 as any);
  }

  function hide(re: RegExp): void {
    r(re, (s) => {
      hidden.push(s);
      return `\x01${hidden.length}\x02`;
    });
  }

  function hideTag(tag: string): void {
    hide(
      new RegExp("<" + tag + "( [^>]+)?>[\\s\\S]+?<\\/" + tag + ">", "gi")
    );
  }

  const thinspace = "\u202F";
  const u = "\u00A0"; //unbreakable space

  hideTag("html");
  hideTag("m");
  hide(/^ .*$/gim); //lines starting with space
  hide(
    /(http|https|ftp|tftp|news|nntp|telnet|irc|gopher):\/\/[^ \n\r\u00A0]* ?/gi
  ); //links

  hideTag("nowiki");
  hideTag("pre");
  hideTag("source");
  hideTag("syntaxhighlight");
  hideTag("code[\\-\\w]*");
  hideTag("tt");
  hideTag("math");
  hideTag("timeline");
  hide(/\w+-\w+/g);

  r(/( |\n|\r)+\{\{(·|•|\*)\}\}/g, "{{$2}}"); //before {{·/•/*}}, usually in templates
  r(/{\{\s*([Шш]аблон|[tT]emplate):([\s\S]+?)}}/g, "{{$2}}");
  r(/({\{\s*)reflist(\s*[|}])/gi, "$1примечания$2");
  hide(/{\{[\s\S]+?}}/g); //templates

  hide(/^ .*/gm);
  hide(/(https?|ftp|news|nntp|telnet|irc|gopher):\/\/[^\s\[\]<>"]+ ?/gi);
  hide(/^#(redirect|перенапр(авление)?)/i);
  hideTag("gallery");

  r(/ +(\n|\r)/g, "$1"); //spaces at EOL
  txt = "\n" + txt + "\n";

  //Linked years, centuries and ranges
  r(
    /(\(|\s)(\[\[[12]?\d{3}\]\])[\u00A0 ]?(-{1,3}|–|—) ?(\[\[[12]?\d{3}\]\])(\W)/g,
    "$1$2—$4$5"
  );
  r(/(\[\[[12]?\d{3}\]\]) ?(гг?\.)/g, "$1" + u + "$2");
  r(
    /(\(|\s)(\[\[[IVX]{1,5}\]\])[\u00A0 ]?(-{1,3}|–|—) ?(\[\[[IVX]{1,5}\]\])(\W)/g,
    "$1$2—$4$5"
  );
  r(/(\[\[[IVX]{1,5}\]\]) ?(вв?\.)/g, "$1" + u + "$2");
  r(/\[\[(\d+)\]\]\sгод/g, "[[$1" + u + "год]]");
  r(/\[\[(\d+)\sгод\|\1\]\]\sгод/g, "[[$1" + u + "год]]");
  r(/\[\[(\d+)\sгод\|\1\sгод([а-я]{0,3})\]\]/g, "[[$1" + u + "год]]$2");
  r(
    /\[\[((\d+)(?: (?:год )?в [\wa-яёА-ЯЁ ]+\|\2)?)\]\][\u00A0 ](год[а-яё]*)/g,
    "[[$1" + u + "$3]]"
  );
  r(/\[\[([XVI]+)\]\]\sвек/g, "[[$1" + u + "век]]");
  r(/\[\[([XVI]+)\sвек\|\1\]\]\sвек/g, "[[$1" + u + "век]]");
  r(/\[\[([XVI]+)\sвек\|\1\sвек([а-я]{0,3})\]\]/g, "[[$1" + u + "век]]$2");
  r(/\[\[(([XVI]+) век\|\2)\]\][\u00A0 ]век/g, "[[$2" + u + "век]]");
  // Nice links
  r(/(\[\[[^|\[\]]*)[\u00AD\u200E\u200F]+([^\[\]]*\]\])/g, "$1$2"); // Soft Hyphen & DirMark
  r(/\[\[ *([^|\[\]]+) *\| *(\1)([a-zа-яё]*) *\]\]/g, "[[$2]]$3");
  r(/\[\[ *([^|\[\]]+)([^|\[\]()]+) *\| *\1 *\]\]\2/g, "[[$1$2]]"); // text repetition after link
  r(
    /\[\[ *(?!Файл:|Категория:|File:|Image:|Category:)([a-zA-Zа-яёА-ЯЁ\u00A0-\u00FF %!\"$&'()*,\-—.\/0-9:;=?\\@\^_`’~]+) *\| *([^|[\]]+) *\]\]([a-zа-яё]+)/g,
    "[[$1|$2$3]]"
  );
  hide(/\[\[[^\]|]+/g); //only link part

  //TAGS
  r(/\$([^$\n]*\\[^$\n]*)\$/g, (match, content) => {
    const replacement = `<math>${content}</math>`;
    hidden.push(replacement);
    return `\x01${hidden.length}\x02`;
  });
  r(/`([^`\n]+)`/g, (match, content) => {
    const replacement = `<tt>${content}</tt>`;
    hidden.push(replacement);
    return `\x01${hidden.length}\x02`;
  });
  r(/<<(\S.+\S)>>/g, '"$1"'); //<< >>
  r(/(su[pb]>)-(\d)/g, "$1−$2"); // ->minus
  r(/&sup2;/gi, "²");
  r(/&sup3;/gi, "³");
  r(/<(b|strong)>(.*?)<\/(b|strong)>/gi, "'''$2'''");
  r(/<(i|em)>(.*?)<\/(i|em)>/gi, "''$2''");
  r(/^<hr ?\/?>/gim, "----");
  r(/<[\/\\]?(hr|br)( [^\/\\>]+?)? ?[\/\\]?>/gi, "<$1$2 />");
  r(/[\u00A0 \t]*<ref(?:\s+name="")?(\s|>)/gi, "<ref$1");
  r(
    /(\n== *[a-zа-я\s\.:]+ *==\n+)<references *\/>/gi,
    "$1{{примечания}}"
  );
  // Hide any tag with content, to prevent wikifying code/dsl inside.
  hide(/<([a-z][a-z0-9]*)(?: [^>]+)?>[\s\S]*?<\/\1>/gi);
  hide(/<[a-z][^>]*?>/gi);

  hide(/^({\||\|-).*/gm); //table/row def
  hide(/(^\||^!|!!|\|\|) *[a-z]+=[^|]+\|(?!\|)/gim); //cell style
  hide(/\| +/g); //formatted cell

  r(/[ \t\u00A0]*\t[ \t\u00A0]*/g, "\t"); //allow tab-formatted tables
  // r(/[ \u00A0]+/g, " "); //double spaces

  // Headings
  r(/^(=+)[ \t\f\v]*(.*?)[ \t\f\v]*=+$/gm, "$1 $2 $1"); //add spaces inside
  r(/([^\r\n])(\r?\n==.*==\r?\n)/g, "$1\n$2"); //add empty line before
  r(/^== см(\.?|отри|отрите) ?также ==$/gim, "== См. также ==");
  r(/^== сноски ==$/gim, "== Примечания ==");
  r(/^== внешние\sссылки ==$/gim, "== Ссылки ==");
  r(/^== (.+)[.:] ==$/gm, "== $1 ==");
  r(/^== '''(?!.*'''.*''')(.+)''' ==$/gm, "== $1 ==");

  r(/«|»|“|”|„/g, '"'); //temp

  // Hyphens and en dashes to pretty dashes
  r(/–/g, "-"); //&ndash; ->  hyphen
  r(/&(#151|[nm]dash);/g, "—"); // -> &mdash;
  r(/(\s)-(\d)/g, "$1−$2"); //hyphen -> minus
  r(/(\d)--(\d)/g, "$1—$2"); // -> &mdash;
  r(/\s+-{1,3}\s+/g, " — "); // hyphen -> &mdash;

  // Entities etc. → Unicode chars
  r(/&#x([0-9a-f]{1,4});/gi, (n, a) => String.fromCharCode(parseInt(a, 16)));
  r(/&copy;/gi, "©");
  r(/&reg;/gi, "®");
  r(/&sect;/gi, "§");
  r(/&euro;/gi, "€");
  r(/&yen;/gi, "¥");
  r(/&pound;/gi, "£");
  r(/&deg;/g, "°");
  r(/\(tm\)|&trade;/gi, "™");
  r(/\.\.\.|&hellip;/g, "…");
  r(/(^|[^+])\+-(?!\+|-)|&plusmn;/g, "$1±");
  r(/~=/g, "≈");
  r(/\^2(\D)/g, "²$1");
  r(/\^3(\D)/g, "³$1");
  r(/(\s)кв\.\s*(дм|см|мм|мкм|нм|км|м)(\s)/g, "$1" + u + "$2²$3");
  r(/(\s)куб\.\s*(дм|см|мм|мкм|нм|км|м)(\s)/g, "$1" + u + "$2³$3");
  r(
    /((?:^|[\s"])\d+(?:[\.,]\d+)?)\s*[xх]\s*(\d+(?:[\.,]\d+)?)\s*([мm]{1,2}(?:[\s"\.,;?!]|$))/g,
    "$1×$2" + u + "$3"
  );
  r(/&((la|ra|bd|ld)quo|quot);/g, '"');
  r(/([\wа-яА-ЯёЁ])'([\wа-яА-ЯёЁ])/g, "$1’$2"); //'
  r(/№№/g, "№");

  // Year and century ranges
  r(
    /(\(|\s)([12]?\d{3})[\u00A0 ]?(-{1,3}|—) ?([12]?\d{3})(?![\wА-ЯЁа-яё]|-[^ех]|-[ех][\wА-ЯЁа-яё])/g,
    "$1$2—$4"
  );
  r(/([12]?\d{3}) ?(гг?\.)/g, "$1" + u + "$2");
  r(
    /(\(|\s)([IVX]{1,5})[\u00A0 ]?(-{1,3}|—) ?([IVX]{1,5})(?![\w-])/g,
    "$1$2—$4"
  );
  r(/([IVX]{1,5}) ?(вв?\.)/g, "$1" + u + "$2");

  // Reductions
  r(/(Т|т)\.\s?е\./g, "$1о есть");
  r(/(Т|т)\.\s?к\./g, "$1ак как");
  r(/(В|в)\sт\. ?ч\./g, "$1 том числе");
  r(/(И|и)\sт\.\s?д\./g, "$1" + u + "т." + u + "д.");
  r(/(И|и)\sт\.\s?п\./g, "$1" + u + "т." + u + "п.");
  r(/(Т|т)\.\s?н\./g, "$1." + u + "н.");
  r(/(И|и)\.\s?о\./g, "$1." + u + "о.");
  r(/н\.\s?э(\.|(?=\s))/g, "н." + u + "э.");
  r(/(Д|д)(о|\.)\sн\.\s?э\./g, "$1о" + u + "н." + u + "э.");
  r(
    /(\d)[\u00A0 ]?(млн|млрд|трлн|(?:м|с|д|к)?м|[км]г)\.?(?=[,;.]| "?[а-яё-])/g,
    "$1" + u + "$2"
  );
  r(/(\d)[\u00A0 ](тыс)([^\.А-Яа-яЁё])/g, "$1" + u + "$2.$3");
  r(/ISBN:\s?(?=[\d\-]{8,17})/, "ISBN ");

  // Insert/delete spaces
  r(/^([#*:]+)[ \t\f\v]*(?!\{\|)([^ \t\f\v*#:;])/gm, "$1 $2"); //space after #*: unless before table
  // r(/(\S)[\u00A0 \t](-{1,3}|—)[\u00A0 \t](\S)/g, "$1" + u + "— $3");
  r(
    /([А-ЯЁ]\.) ?([А-ЯЁ]\.) ?([А-ЯЁ][а-яё])/g,
    "$1" + thinspace + "$2" + thinspace + "$3"
  );
  r(/([А-ЯЁ]\.)([А-ЯЁ]\.)/g, "$1" + thinspace + "$2");
  r(/(г\.) ?([А-Я][а-я])/g, "$1" + thinspace + "$2");
  r(/([а-яё]"?\)?[\.\?!:])((?:\x01\d+\x02\|)?[A-ZА-ЯЁ])/g, "$1 $2"); // word. word
  r(/([)"a-zа-яё\]])\s*([,:])([\[("a-zа-яё])/g, "$1$2 $3"); // word, word
  r(/([)"a-zа-яё\]])\s([,;])\s([\[("a-zа-яё])/g, "$1$2 $3");
  r(
    /([^%\/\wА-Яа-яЁё]\d+?(?:[\.,]\d+?)?) ?([%‰])(?!-[А-Яа-яЁё])/g,
    "$1" + u + "$2"
  ); //5 %
  r(/(\d) ([%‰])(?=-[А-Яа-яЁё])/g, "$1$2"); //5%-й
  r(/([№§])(\s*)(\d)/g, "$1" + u + "$3");
  r(/\( +/g, "(");
  r(/ +\)/g, ")"); //inside ()

  //Temperature
  r(
    /([\s\d=≈≠≤≥<>—("'|])([+±−-]?\d+?(?:[.,]\d+?)?)(([ °^*]| [°^*])C)(?=[\s"').,;!?|\x01])/gm,
    "$1$2" + u + "°C"
  );
  r(
    /([\s\d=≈≠≤≥<>—("'|])([+±−-]?\d+?(?:[.,]\d+?)?)(([ °^*]| [°^*])F)(?=[\s"').,;!?|\x01])/gm,
    "$1$2" + u + "°F"
  );

  //Dot → comma in numbers
  r(/(\s\d+)\.(\d+[\u00A0 ]*[%‰°×])/gi, "$1,$2");

  //"" → «»
  // A more robust regex to handle quotes.
  // It looks for an opening quote preceded by a non-word character (or start of line).
  r(/(^|\W)"([^"]+)"/g, "$1«$2»");
  while (/«[^»]*«/.test(txt)) {
    r(/«([^»]*)«([^»]*)»/g, "«$1„$2“");
  }

  while (hidden.length > 0) {
    const replacement = hidden.pop()!;
    const safeReplacement = replacement.replace(/\$/g, "$$$$");
    txt = txt.replace("\x01" + (hidden.length + 1) + "\x02", safeReplacement);
  }
  txt = txt.substring(1, txt.length - 1);

  return txt;
}
