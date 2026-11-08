// Sanity-checks issues and closes the ones that are invalid or not in English,
// with a comment saying why and how to fix it. Run by
// .github/workflows/issue-triage.yml. Everything is decided here, offline:
// issue text is never sent to any other service.
//
// The maintainer's and collaborators' issues, bots' issues, issues with the
// `triage-ok` label, issues assigned to the maintainer and closed issues
// someone reopened by hand are never touched. An issue closed by this script
// is reopened when its author edits it into shape.

export type IssueInput = {
    title: string;
    body: string | null;
    authorAssociation: string;
    authorType?: string;
    labels: string[];
    assignees?: string[];
};

export type Verdict =
    | { action: 'keep' }
    | { action: 'close'; reason: 'invalid' | 'non-english'; message: string };

export const CLOSED_LABEL = 'auto-closed';
export const EXEMPT_LABEL = 'triage-ok';
// Issues assigned to the maintainer are being handled; leave them.
export const MAINTAINER = 'NanashiTheNameless';
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

const USER_ID =
    /^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Answers of an issue form, by heading. Empty answers come back as ''. */
export function formAnswers(body: string): Map<string, string> {
    const answers = new Map<string, string>();
    const parts = body.split(/^### +/m).slice(1);
    for (const part of parts) {
        const newline = part.indexOf('\n');
        const heading = (newline < 0 ? part : part.slice(0, newline)).trim();
        let answer = newline < 0 ? '' : part.slice(newline + 1).trim();
        if (answer === '_No response_' || answer === 'None') {
            answer = '';
        }
        answers.set(heading, answer);
    }
    return answers;
}

type Template = {
    name: string;
    // Headings that identify the form.
    marker: string;
    // Answers that must hold real text.
    required: string[];
    // Answers left out of the language check (ids, names, logs).
    skip: string[];
};

const TEMPLATES: Template[] = [
    {
        name: 'Bug Report',
        marker: 'What happened?',
        required: ['What happened?'],
        skip: [
            'VRCX-0-Nanashi version',
            'Operating system',
            'Screenshots / error log',
            'VRChat user ID (optional, for a badge)'
        ]
    },
    {
        name: 'Feature Request',
        marker: 'What would you like to see?',
        required: ['What would you like to see?'],
        skip: ['VRChat user ID (optional, for a badge)']
    },
    {
        name: 'Badge Request',
        marker: 'Which badge?',
        required: ['What did you do?'],
        skip: [
            'VRChat user ID',
            'VRChat display name',
            'Which badge?',
            'Consent'
        ]
    }
];

// Strips what says nothing about the language: code, links, mentions, ids.
function prose(text: string): string {
    return text
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`]*`/g, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/@[\w-]+/g, ' ')
        .replace(/\b(usr|wrld|avtr|grp)_[\w-]+/gi, ' ');
}

const ENGLISH = new Set(
    (
        'the and is are was were be been to of in on at for with it this that ' +
        'not no but or if when what why how can could would should will do ' +
        'does did have has had i you he she we they my your our their me ' +
        'from by as an so there here just only also about after before ' +
        'which who all some any more very than then into out up down get ' +
        'got make made work works working use using want need like app ' +
        'please thanks thank error crash shows show open opened'
    ).split(' ')
);

// Common words of other Latin-script languages that are not English words.
const OTHER = new Set(
    // Spanish / Portuguese
    (
        'el la los las una unos que del por para con pero como cuando ' +
        'porque esta este estos muy tambien cuando hay puedo funciona ' +
        'nao uma com mas quando porque isso esse essa muito voce ' +
        'tem fazer obrigado gracias hola ' +
        // French
        'le les des une est sont avec pour pas mais quand parce cette ' +
        'ce ces je tu nous vous ils elle dans sur fonctionne merci bonjour ' +
        // German
        'der das und ist nicht ein eine mit auf bei wenn aber auch ' +
        'ich du wir ihr sie es funktioniert danke bitte hallo ' +
        // Italian / Dutch
        'il gli sono questo questa perche non ho grazie ciao ' +
        'het een niet maar ook ik werkt bedankt ' +
        // Polish / Turkish / Indonesian
        'nie jest sie jak ale dla czy dziekuje ' +
        've bir bu da ile icin ama cok tesekkurler ' +
        'yang dan tidak ini itu dengan untuk tapi bisa terima kasih ' +
        // Swedish / Norwegian / Danish
        'och att det som inte med jag har kan ikke ikkje og jeg er til ' +
        'paa tack takk tak hej ' +
        // Czech / Slovak / Romanian / Hungarian
        'je se na ze jsem neni ale aby jako dekuji prosim ' +
        'si cu sunt nu este pentru dar multumesc ' +
        'az es hogy nem egy ez meg koszonom ' +
        // Vietnamese / Finnish
        'khong cua cho duoc nhung nay mot ' +
        'ja ei se kun mutta kiitos'
    ).split(' ')
);

/** True when the text is clearly not English. Short text is given the benefit of the doubt. */
export function looksNonEnglish(text: string): boolean {
    const clean = prose(text);
    const letters = clean.match(/\p{L}/gu) ?? [];
    if (letters.length >= 20) {
        const latin = clean.match(/\p{Script=Latin}/gu) ?? [];
        if ((letters.length - latin.length) / letters.length > 0.3) {
            return true;
        }
    }
    const words = (
        clean
            .normalize('NFD')
            .replace(/\p{M}/gu, '')
            .toLowerCase()
            .match(/\p{L}+/gu) ?? []
    ).filter((word) => word.length > 1);
    if (words.length < 12) {
        return false;
    }
    let english = 0;
    let other = 0;
    for (const word of words) {
        if (ENGLISH.has(word)) {
            english += 1;
        } else if (OTHER.has(word)) {
            other += 1;
        }
    }
    return other >= 4 && other > english * 2;
}

function meaningful(text: string, min = 15): boolean {
    return prose(text).replace(/\s+/g, ' ').trim().length >= min;
}

const FOOTER =
    '\n\nIf this is a mistake, edit the issue to fix it and it will be reopened automatically.';

export function checkIssue(issue: IssueInput): Verdict {
    if (
        TRUSTED.has(issue.authorAssociation) ||
        issue.authorType === 'Bot' ||
        issue.labels.includes(EXEMPT_LABEL) ||
        (issue.assignees ?? []).some(
            (login) => login.toLowerCase() === MAINTAINER.toLowerCase()
        )
    ) {
        return { action: 'keep' };
    }
    const body = issue.body ?? '';
    const answers = formAnswers(body);
    const template = TEMPLATES.find((entry) => answers.has(entry.marker));

    const checked = [
        issue.title,
        ...(template
            ? [...answers]
                  .filter(([heading]) => !template.skip.includes(heading))
                  .map(([, answer]) => answer)
            : [body])
    ].join('\n');
    if (looksNonEnglish(checked)) {
        return {
            action: 'close',
            reason: 'non-english',
            message:
                'Thanks for the report. Issues on this fork must be written in English; other ' +
                'languages are not supported (see CONTRIBUTING.md). Please rewrite it in English; ' +
                'a machine translation is fine.' +
                FOOTER
        };
    }

    const invalid = (why: string): Verdict => ({
        action: 'close',
        reason: 'invalid',
        message: `Thanks for opening this. It was closed because ${why}${FOOTER}`
    });
    if (!template) {
        return invalid(
            'it does not use one of the issue forms. Please open a new issue from ' +
                'https://github.com/NanashiTheNameless/VRCX-0-Nanashi/issues/new/choose'
        );
    }
    for (const heading of template.required) {
        if (!meaningful(answers.get(heading) ?? '')) {
            return invalid(
                `the "${heading}" part of the ${template.name} form is empty or too short ` +
                    'to act on. Please describe it in a sentence or two.'
            );
        }
    }
    if (template.name === 'Badge Request') {
        const id = (answers.get('VRChat user ID') ?? '').trim();
        if (!USER_ID.test(id)) {
            return invalid(
                'the VRChat user ID is not one. It looks like ' +
                    '`usr_12345678-abcd-1234-abcd-1234567890ab` and is in your profile link on vrchat.com.'
            );
        }
    }
    const title = issue.title.trim().replace(/^Badge request:\s*/i, '');
    if (!meaningful(title, 3)) {
        return invalid('the title is empty. Please give it a short summary.');
    }
    return { action: 'keep' };
}

// ---- GitHub side ----------------------------------------------------------

type GitHubIssue = {
    number: number;
    title: string;
    body: string | null;
    state: string;
    author_association: string;
    user: { type?: string } | null;
    labels: ({ name?: string } | string)[];
    assignees?: { login: string }[] | null;
    pull_request?: unknown;
};

const API = 'https://api.github.com';

async function api(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch(`${API}${path}`, {
        ...init,
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
            ...init.headers
        }
    });
    if (!response.ok) {
        throw new Error(
            `${init.method ?? 'GET'} ${path}: HTTP ${response.status}`
        );
    }
    return response.status === 204 ? null : response.json();
}

function labelNames(issue: GitHubIssue): string[] {
    return issue.labels
        .map((label) =>
            typeof label === 'string' ? label : (label.name ?? '')
        )
        .filter(Boolean);
}

async function triage(repo: string, issue: GitHubIssue, dryRun: boolean) {
    if (issue.pull_request) {
        return;
    }
    const labels = labelNames(issue);
    if (issue.state === 'open' && labels.includes(CLOSED_LABEL)) {
        // Closed by this script and reopened by hand: a person decided.
        console.log(`#${issue.number}: reopened by hand, leaving it`);
        return;
    }
    const verdict = checkIssue({
        title: issue.title,
        body: issue.body,
        authorAssociation: issue.author_association,
        authorType: issue.user?.type,
        labels,
        assignees: (issue.assignees ?? []).map((user) => user.login)
    });
    const path = `/repos/${repo}/issues/${issue.number}`;
    const say = (body: string) =>
        api(`${path}/comments`, {
            method: 'POST',
            body: JSON.stringify({ body })
        });

    if (issue.state === 'open' && verdict.action === 'close') {
        console.log(`#${issue.number}: closing (${verdict.reason})`);
        if (dryRun) {
            return;
        }
        await say(verdict.message);
        await api(`${path}/labels`, {
            method: 'POST',
            body: JSON.stringify({ labels: [CLOSED_LABEL, verdict.reason] })
        });
        await api(path, {
            method: 'PATCH',
            body: JSON.stringify({
                state: 'closed',
                state_reason: 'not_planned'
            })
        });
        return;
    }
    if (
        issue.state === 'closed' &&
        labels.includes(CLOSED_LABEL) &&
        verdict.action === 'keep'
    ) {
        console.log(`#${issue.number}: reopening, it passes now`);
        if (dryRun) {
            return;
        }
        for (const label of [CLOSED_LABEL, 'invalid', 'non-english']) {
            if (labels.includes(label)) {
                await api(`${path}/labels/${encodeURIComponent(label)}`, {
                    method: 'DELETE'
                });
            }
        }
        await api(path, {
            method: 'PATCH',
            body: JSON.stringify({ state: 'open' })
        });
        await say(
            'Thanks for the update. This issue passes the checks now, so it is open again.'
        );
        return;
    }
    console.log(`#${issue.number}: ok`);
}

async function main() {
    const repo = process.env.GITHUB_REPOSITORY;
    if (!repo || !process.env.GITHUB_TOKEN) {
        throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN must be set.');
    }
    const dryRun = process.env.DRY_RUN === 'true';
    if (process.env.GITHUB_EVENT_NAME === 'issues') {
        const { readFile } = await import('node:fs/promises');
        const event = JSON.parse(
            await readFile(process.env.GITHUB_EVENT_PATH ?? '', 'utf8')
        ) as { issue: GitHubIssue };
        await triage(repo, event.issue, dryRun);
        return;
    }
    // Scheduled or manual run: every open issue.
    for (let page = 1; ; page += 1) {
        const issues = (await api(
            `/repos/${repo}/issues?state=open&per_page=100&page=${page}`
        )) as GitHubIssue[];
        for (const issue of issues) {
            await triage(repo, issue, dryRun);
        }
        if (issues.length < 100) {
            return;
        }
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error: unknown) => {
        console.error(error);
        process.exit(1);
    });
}
