// Based on wikEd.WikifyHTML from https://en.wikipedia.org/wiki/User:Cacycle/wikEd.js

function SanitizeAttributes(tag: string, attributes: string, wikiCode: boolean): string {
    attributes = attributes || '';
    let common: string;
    let tablealign: string;
    let tablecell: string;
    let table: string;
    if (wikiCode === true) {
        common = '|dir|style|class|lang|id|title|';
        tablealign = '|align|char|charoff|valign|';
        table = '|summary|width|border|frame|rules|cellspacing|cellpadding|align|bgcolor|';
        tablecell = '|abbr|axis|headers|scope|rowspan|colspan|nowrap|width|height|bgcolor|';
    } else {
        common = '|dir|';
        table = '|border|cellspacing|cellpadding|align|bgcolor|';
        tablealign = '|align|valign|';
        tablecell = '|rowspan|colspan|nowrap|bgcolor|';
    }
    tag = tag.toLowerCase();
    let sanitized = '';

    const regExp = /\s*(\w+)(\s*=\s*(('|")(.*?)\4|(\w+)))?\s*/g;
    let regExpMatch;

    while ((regExpMatch = regExp.exec(attributes)) !== null) {
        const attrib = regExpMatch[1].toLowerCase();
        const attribValue = regExpMatch[5] || regExpMatch[6] || '';
        let valid = false;
        const tagCheck = '|' + tag + '|';
        const attribCheck = '|' + attrib + '|';

        const allowedAttrs = /^(href|src|class|id|style|align|valign|rowspan|colspan|border|cellspacing|cellpadding|width|height|title|alt|name|clear|type|start|value|summary|char|charoff|abbr|axis|headers|scope|nowrap|bgcolor|face|size|color|datetime|lang|dir)$/i;
        if (allowedAttrs.test(attrib)) {
            valid = true;
        }

        if (!valid) {
            continue;
        }

        if (attribValue !== '') {
            sanitized += ' ' + attrib + '="' + attribValue + '"';
        }
    }
    return sanitized;
}

function RemoveTag(html: string, tag: string, attribRegExp: RegExp | null = null, replaceOpen: string = '', replaceClose: string = ''): string {
    const tagRegExp = new RegExp('(<(\\/?)(' + tag + ')\\b([^>]*)>)', 'g');

    let isRemove: boolean[] = [];
    html = html.replace(tagRegExp,
        (p, p1, p2, p3, p4) => {
            p2 = p2 || '';
            p4 = p4 || '';
            if (p2 === '') {
                if (
                    ((attribRegExp === null) && (p4.trim() === '')) ||
                    ((attribRegExp !== null) && (attribRegExp.test(p4)))
                ) {
                    isRemove.push(true);
                    return replaceOpen;
                }
                isRemove.push(false);
                return p1;
            }
            if (isRemove.pop() === true) {
                return replaceClose;
            }
            return p1;
        }
    );
    return html;
}

function prettyPrintHtmlTable(html: string): string {
    const oneLineHtml = html.replace(/>\s+</g, '><').replace(/[\r\n]/g, ' ').replace(/\s{2,}/g, ' ').trim();
    const parts = oneLineHtml.split(/(<[^>]+>)/).filter(p => p && p.trim());

    let indent = 0;
    const result = [];
    const tagStack: string[] = [];

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (!part) continue;

        const inCell = tagStack.includes('td') || tagStack.includes('th');

        if (part.startsWith('</')) {
            indent = Math.max(0, indent - 1);
            
            const tagNameMatch = part.match(/^<\/([a-zA-Z0-9]+)/);
            const tagName = tagNameMatch ? tagNameMatch[1].toLowerCase() : '';
            const isCellTag = tagName === 'td' || tagName === 'th';

            if (inCell && !isCellTag) {
                result.push(part);
            } else {
                result.push('  '.repeat(indent) + part);
            }
            tagStack.pop();
        } else if (part.startsWith('<')) {
            if (inCell) {
                result.push(part);
            } else {
                result.push('  '.repeat(indent) + part);
            }
            
            const tagNameMatch = part.match(/^<([a-zA-Z0-9]+)/);
            if (tagNameMatch) {
                const tagName = tagNameMatch[1].toLowerCase();
                if (!part.endsWith('/>') && !['br', 'hr', 'img', 'input', 'col'].includes(tagName)) {
                    indent++;
                    tagStack.push(tagName);
                }
            }
        } else {
            // content
            if (inCell) {
                result.push(part);
            } else {
                result.push('  '.repeat(indent) + part);
            }
        }
    }
    return result.join('\n');
}

export function html2mw(html: string): string {
    let text = html;
    const wikiCode = false;
    const hidden: string[] = [];

    // Hide tables by replacing them with a placeholder
    text = text.replace(/<table\b[\s\S]*?<\/table>/gi, (match) => {
        // Remove <colgroup> elements as they are not supported in wikitext
        let cleanedMatch = match.replace(/<colgroup\b[\s\S]*?<\/colgroup>/gi, '');

        // Remove <tbody> tags, preserving content
        cleanedMatch = cleanedMatch.replace(/<\/?tbody[^>]*>/gi, '');

        // Remove class attributes from all table elements
        cleanedMatch = cleanedMatch.replace(/\s+class\s*=\s*(["'])(?:(?!\1).)*\1/gi, '');

        // Remove empty/attributeless <span> and <div> tags inside tables, preserving content
        let previousMatch;
        do {
            previousMatch = cleanedMatch;
            cleanedMatch = cleanedMatch.replace(/<span\s*>([\s\S]*?)<\/span>/gi, '$1');
            cleanedMatch = cleanedMatch.replace(/<div\s*>([\s\S]*?)<\/div>/gi, '$1');
        } while (previousMatch !== cleanedMatch);

        // Remove width:0px from table style attribute
        cleanedMatch = cleanedMatch.replace(/<table\b[^>]*>/i, (tableTag) => {
            const newTag = tableTag.replace(/style=(["'])(.*?)\1/i, (attrMatch, quote, styleContent) => {
                const hadSemicolon = styleContent.trim().endsWith(';');
                const styles = styleContent.split(';')
                    .map((s: string) => s.trim())
                    .filter((s: string) => s && !/^\s*width\s*:\s*0px\s*$/i.test(s));
                
                const newStyle = styles.join('; ');

                if (newStyle.length > 0) {
                    let finalStyle = newStyle;
                    if (hadSemicolon && !finalStyle.endsWith(';')) {
                        finalStyle += ';';
                    }
                    return `style=${quote}${finalStyle}${quote}`;
                } else {
                    return ''; // remove attribute
                }
            });
            return newTag.replace(/\s\s+/g, ' ').replace(/\s+>/, '>');
        });

        cleanedMatch = prettyPrintHtmlTable(cleanedMatch);
        hidden.push(cleanedMatch);
        return `\x04${hidden.length - 1}\x05`;
    });

    text = text.replace(/(<(syntaxhighlight|source|pre|nowiki)\b[^\/>]*>)((.|\n)*?)(<\/\2>)/gi,
        (p, p1, p2, p3, p4, p5) => {
            p3 = p3.replace(/</g, '\x01').replace(/>/g, '\x02');
            if (/^(syntaxhighlight|source|pre)$/i.test(p2)) {
                p3 = p3.replace(/ |\xa0/g, '\x03');
            }
            return p1 + p3 + p5;
        }
    );

    text = text.replace(/<(style|script)\b[^>]*>(.|\n)*?<\/\1>/gi, '');
    text = text.replace(/<!--(.|\n)*?-->/g, '');

    text = text.replace(/<(span|div|p|font)\s+([^>]*?)\s*(\/?)>/gi,
        (p, p1, p2, p3) => `<${p1}${SanitizeAttributes(p1, p2, wikiCode)}${p3}>`
    );

    text = RemoveTag(text, 'span|font');
    text = RemoveTag(text, 'p', null, '\x00\x00', '\x00\x00');

    text = text.replace(/&(?!(amp;|lt;|gt;|nbsp;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;))/g, '&amp;');

    text = text.replace(/(\s|<br\b[^>]*>|\x00)*<hr\b[^>]*>(\s|<br\b[^>]*>|\x00)*()/gi, '\x00\x00----\x00\x00');

    text = text.replace(/<(i|em|dfn|var|cite)\b[^>]*?>/gi, "''");
    text = text.replace(/<\/(i|em|dfn|var|cite)\b[^>]*?>/gi, "''");
    text = text.replace(/<(b|strong)\b[^>]*?>/gi, "'''");
    text = text.replace(/<\/(b|strong)\b[^>]*?>/gi, "'''");

    for (let i = 6; i >= 1; i--) {
        const eq = '='.repeat(i);
        const h_re = new RegExp(`(\\s|<br\\b[^>]*>|\\x00)*(^|\\n|<br\\b[^>]*>|\\x00)(\\s|<br\\b[^>]*>|\\x00)*<h${i}\\b[^>]*>((.|\\n)*?)<\\/h${i}>(\\s|<br\\b[^>]*>|\\x00)*()`, 'gi');
        text = text.replace(h_re, `\x00\x00${eq} $4 ${eq}\x00\x00`);
    }

    let listObj = { prefix: '' };
    text = text.replace(/[\s\x00]*<(\/?(ol|ul|li|dl|dd|dt))\b[^>]*>[\s\x00]*()/gi,
        (p, p1) => {
            switch (p1.toLowerCase()) {
                case 'ol': listObj.prefix += '#'; return '\x00';
                case 'ul': listObj.prefix += '*'; return '\x00';
                case 'dl': listObj.prefix += ':'; return '\x00';
                case '/ol': case '/ul': case '/dl':
                    if (listObj.prefix.length > 0) {
                        listObj.prefix = listObj.prefix.substring(0, listObj.prefix.length - 1);
                    }
                    return '\x00\x00';
                case 'li': case 'dd': return '\x00' + listObj.prefix + ' ';
                case 'dt': return '\x00' + listObj.prefix.replace(/:$/, ';') + ' ';
                case '/li': case '/dt': case '/dd': return '';
            }
            return '';
        }
    );
    text = text.replace(/[\n|\x00]+[#*:;]+\s(?=[\n|\x00])/g, '');

    text = text.replace(/<a\s+href=(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>((.|\n)*?)<\/a>/gi,
        (match, href1, href2, href3, content) => {
            const href = href1 || href2 || href3;
            if (href) {
                const cleanContent = content.replace(/<[^>]+>/g, '').trim();
                if (cleanContent && cleanContent !== href) {
                    return `[${href} ${cleanContent}]`;
                }
                return `[${href}]`;
            }
            return content;
        }
    );

    text = text.replace(/<br\s*\/?>[\n ]*()/gi, '\x00');
    text = text.replace(/<[^>]*>/g, '');

    text = text.replace(/\x00+\n/g, '\n\n').replace(/\n\x00+/g, '\n\n').replace(/\n*\x00(\x00|\n)+/g, '\n\n').replace(/\x00/g, '\n');
    text = text.replace(/\x01/g, '<').replace(/\x02/g, '>').replace(/\x03/g, '\xa0');

    text = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, '\u00A0').replace(/&amp;/g, '&');

    // Restore hidden tables
    for (let i = 0; i < hidden.length; i++) {
        text = text.replace(`\x04${i}\x05`, hidden[i]);
    }

    return text.trim();
}
