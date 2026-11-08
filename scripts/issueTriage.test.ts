import { describe, expect, it } from 'vitest';

import { checkIssue, formAnswers, looksNonEnglish } from './issue-triage';

const USER = 'usr_11111111-1111-1111-1111-111111111111';

function bug(whatHappened: string, extra = '') {
    return [
        '### VRCX-0-Nanashi version',
        '',
        '2026.11.07',
        '',
        '### Operating system',
        '',
        'Windows 11',
        '',
        '### What happened?',
        '',
        whatHappened,
        '',
        '### What did you expect to happen?',
        '',
        '_No response_',
        '',
        '### Screenshots / error log',
        '',
        extra || '_No response_'
    ].join('\n');
}

function issue(title: string, body: string | null, more = {}) {
    return {
        title,
        body,
        authorAssociation: 'NONE',
        labels: [] as string[],
        ...more
    };
}

describe('formAnswers', () => {
    it('reads answers and treats "_No response_" as empty', () => {
        const answers = formAnswers(bug('It crashed.'));
        expect(answers.get('What happened?')).toBe('It crashed.');
        expect(answers.get('What did you expect to happen?')).toBe('');
    });
});

describe('looksNonEnglish', () => {
    it('accepts English, including short and technical text', () => {
        expect(
            looksNonEnglish(
                'The app crashes when I open the friends list after logging in with two accounts.'
            )
        ).toBe(false);
        expect(looksNonEnglish('Crash on start')).toBe(false);
        expect(
            looksNonEnglish('```\nthread main panicked at src/lib.rs\n```')
        ).toBe(false);
    });

    it('flags other scripts', () => {
        expect(
            looksNonEnglish(
                'フレンドリストを開くとアプリがクラッシュします。助けてください。'
            )
        ).toBe(true);
        expect(
            looksNonEnglish(
                'Приложение вылетает, когда я открываю список друзей.'
            )
        ).toBe(true);
    });

    it('flags other Latin-script languages', () => {
        expect(
            looksNonEnglish(
                'La aplicación se cierra cuando abro la lista de amigos, pero no pasa con la otra cuenta y no sé por qué.'
            )
        ).toBe(true);
        expect(
            looksNonEnglish(
                'Die App stürzt ab, wenn ich die Freundesliste öffne, und das ist nicht gut. Ich habe es auch neu installiert.'
            )
        ).toBe(true);
        expect(
            looksNonEnglish(
                'Appen kraschar när jag öppnar vänlistan och det är inte bra, jag har testat att installera om men det som händer är samma.'
            )
        ).toBe(true);
    });

    it('does not count logs, links and ids', () => {
        expect(
            looksNonEnglish(
                'It crashes on start. `エラー: 接続できませんでした` https://example.com/日本語 usr_abc'
            )
        ).toBe(false);
    });
});

describe('checkIssue', () => {
    it('keeps a good bug report', () => {
        expect(
            checkIssue(
                issue(
                    'Friends list crash',
                    bug(
                        'The app crashes when I open the friends list.',
                        'エラーログ 日本語 テキスト ログ'
                    )
                )
            )
        ).toEqual({ action: 'keep' });
    });

    it('closes a report with an empty description', () => {
        const verdict = checkIssue(issue('Crash', bug('_No response_')));
        expect(verdict).toMatchObject({ action: 'close', reason: 'invalid' });
    });

    it('closes an issue that skips the forms', () => {
        expect(
            checkIssue(issue('Hi', 'The app is broken, please fix it soon.'))
        ).toMatchObject({ action: 'close', reason: 'invalid' });
    });

    it('closes a non-English report', () => {
        expect(
            checkIssue(
                issue(
                    'フレンドリストでクラッシュ',
                    bug(
                        'フレンドリストを開くとアプリがクラッシュします。助けてください。'
                    )
                )
            )
        ).toMatchObject({ action: 'close', reason: 'non-english' });
    });

    it('checks the user id on badge requests', () => {
        const badge = (id: string) =>
            [
                '### VRChat user ID',
                '',
                id,
                '',
                '### Which badge?',
                '',
                'Bug Hunter',
                '',
                '### What did you do?',
                '',
                'Reported the friends list crash in issue 12.'
            ].join('\n');
        expect(
            checkIssue(issue('Badge request: Bug Hunter', badge(USER)))
        ).toEqual({ action: 'keep' });
        expect(
            checkIssue(issue('Badge request: Bug Hunter', badge('my name')))
        ).toMatchObject({ action: 'close', reason: 'invalid' });
        expect(checkIssue(issue('Badge request: ', badge(USER)))).toMatchObject(
            {
                action: 'close',
                reason: 'invalid'
            }
        );
    });

    it('never touches trusted authors, bots or exempt issues', () => {
        expect(
            checkIssue(issue('x', null, { authorAssociation: 'OWNER' }))
        ).toEqual({ action: 'keep' });
        expect(checkIssue(issue('x', null, { authorType: 'Bot' }))).toEqual({
            action: 'keep'
        });
        expect(checkIssue(issue('x', null, { labels: ['triage-ok'] }))).toEqual(
            { action: 'keep' }
        );
        expect(
            checkIssue(issue('x', null, { assignees: ['nanashithenameless'] }))
        ).toEqual({ action: 'keep' });
        expect(
            checkIssue(issue('x', null, { assignees: ['someone-else'] }))
        ).toMatchObject({ action: 'close' });
    });
});
