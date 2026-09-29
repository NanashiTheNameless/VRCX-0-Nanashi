function localeIncludes(
    str: unknown,
    search: unknown,
    comparer: Pick<Intl.Collator, 'compare'>
): boolean {
    // These checks are stolen from https://stackoverflow.com/a/69623589/11030436
    if (search === '') {
        return true;
    } else if (!str || !search) {
        return false;
    }
    const strObj = String(str);
    const searchObj = String(search);

    if (strObj.length === 0) {
        return false;
    }

    if (searchObj.length > strObj.length) {
        return false;
    }

    for (let i = 0; i < strObj.length - searchObj.length + 1; i++) {
        const substr = strObj.substring(i, i + searchObj.length);
        if (comparer.compare(substr, searchObj) === 0) {
            return true;
        }
    }
    return false;
}

function replaceBioSymbols(text: unknown): string {
    if (typeof text !== 'string') {
        return '';
    }
    const symbolList: Record<string, string> = {
        '@': '＠',
        '#': '＃',
        $: '＄',
        '%': '％',
        '&': '＆',
        '=': '＝',
        '+': '＋',
        '/': '⁄',
        '\\': '＼',
        ';': ';',
        ':': '˸',
        ',': '‚',
        '?': '？',
        '!': 'ǃ',
        '"': '＂',
        '<': '≺',
        '>': '≻',
        '.': '․',
        '^': '＾',
        '{': '｛',
        '}': '｝',
        '[': '［',
        ']': '］',
        '(': '（',
        ')': '）',
        '|': '｜',
        '*': '∗'
    };
    let newText = text;
    for (const key in symbolList) {
        const regex = new RegExp(symbolList[key], 'g');
        newText = newText.replace(regex, key);
    }
    return newText.replace(/ {1,}/g, ' ').trimRight();
}

function normalizeString(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export { localeIncludes, normalizeString, replaceBioSymbols };
