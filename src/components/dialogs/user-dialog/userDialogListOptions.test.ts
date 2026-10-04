// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import {
    readUserDialogMutualView,
    writeUserDialogMutualView
} from './userDialogListOptions';

afterEach(() => {
    localStorage.clear();
});

describe('user dialog mutual view preference', () => {
    it('remembers the chosen mutual friends view and falls back to the list', () => {
        expect(readUserDialogMutualView()).toBe('list');

        writeUserDialogMutualView('graph');
        expect(readUserDialogMutualView()).toBe('graph');

        localStorage.setItem('VRCX_0_UserDialogMutualView', 'unknown');
        expect(readUserDialogMutualView()).toBe('list');
    });
});
