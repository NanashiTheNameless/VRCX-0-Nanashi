const PUNCTUATION: Readonly<Record<string, string>> = {
    '\u2018': "'",
    '\u2019': "'",
    '\u201a': "'",
    '\u201b': "'",
    '\u2039': "'",
    '\u203a': "'",
    '\u02bc': "'",
    '\uff07': "'",
    '\u201c': '"',
    '\u201d': '"',
    '\u201e': '"',
    '\u201f': '"',
    '\u00ab': '"',
    '\u00bb': '"',
    '\uff02': '"',
    '\u2010': '-',
    '\u2011': '-',
    '\u2012': '-',
    '\u2212': '-',
    '\u2013': ' - ',
    '\u2014': ' - ',
    '\u2015': ' - ',
    '\u2026': '...',
    '\u00a0': ' ',
    '\u2007': ' ',
    '\u2009': ' ',
    '\u202f': ' ',
    '\u2022': '-',
    '\u2023': '-',
    '\u2043': '-',
    '\u2190': '<-',
    '\u2192': '->',
    '\u2194': '<->'
};
const PATTERN = new RegExp(`[${Object.keys(PUNCTUATION).join('')}]`, 'g');

export function asciiAssistantPunctuation(text: string): string {
    return text.replace(
        PATTERN,
        (character) => PUNCTUATION[character] ?? character
    );
}
