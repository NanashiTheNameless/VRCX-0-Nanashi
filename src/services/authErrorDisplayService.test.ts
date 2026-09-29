import { afterEach, describe, expect, it } from 'vitest';

import { getLoginErrorMessage } from './authErrorDisplayService';
import { setI18nLanguage } from './i18nService';

describe('login error localization', () => {
    it.each([
        [
            'Invalid Username/Email or Password',
            'Invalid username, email, or password.'
        ],
        [
            'Missing Credentials',
            'Missing valid login credentials. Please sign in again.'
        ],
        [
            'The stored browser session still requires interactive verification.',
            'This session requires additional verification. Please sign in manually.'
        ],
        [
            '2FA is required but no supported method was returned.',
            'This account requires two-factor authentication, but no supported verification method is available.'
        ]
    ])('localizes known login failures: %s', async (message, translation) => {
        await setI18nLanguage('en');
        for (const text of [message, JSON.stringify(message)]) {
            expect(getLoginErrorMessage(new Error(text), 'Login failed')).toBe(
                translation
            );
        }
    });

    it('uses the saved-credential error code without changing the error', async () => {
        await setI18nLanguage('en');
        const error = Object.assign(new Error('Original diagnostic message'), {
            code: 'AUTH_SAVED_CREDENTIALS_INVALID'
        });
        expect(getLoginErrorMessage(error, 'Login failed')).toBe(
            'Saved login credentials are no longer valid. The saved account has been removed. Please sign in again.'
        );
        expect(error.message).toBe('Original diagnostic message');
    });

    afterEach(async () => {
        await setI18nLanguage('en');
    });

    it.each([false, true])(
        'maps the new-location login error (quoted: %s) to its English message',
        async (quoted) => {
            const message =
                "It looks like you're logging in from somewhere new! Check your email for a message from VRChat.";
            const error = new Error(
                ` ${quoted ? JSON.stringify(message) : message} `
            );

            await setI18nLanguage('en');
            expect(getLoginErrorMessage(error, 'Login failed')).toBe(message);
        }
    );

    it('returns unknown messages verbatim and falls back on blank or non-Error failures', async () => {
        await setI18nLanguage('zh-CN');
        expect(
            getLoginErrorMessage(
                new Error('Invalid credentials'),
                'Login failed'
            )
        ).toBe('Invalid credentials');
        expect(
            getLoginErrorMessage(
                new Error('"Please contact support: abc"'),
                'Login failed'
            )
        ).toBe('"Please contact support: abc"');
        expect(getLoginErrorMessage(new Error('   '), 'Login failed')).toBe(
            'Login failed'
        );
        expect(
            getLoginErrorMessage({ message: 'Ignored' }, 'Login failed')
        ).toBe('Login failed');
        expect(getLoginErrorMessage(null, 'Login failed')).toBe('Login failed');
    });
});
