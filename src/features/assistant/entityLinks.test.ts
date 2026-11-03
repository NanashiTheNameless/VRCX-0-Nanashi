import { describe, expect, it } from 'vitest';

import { entityHref, parseEntityHref } from './entityLinks';

describe('entity links', () => {
    it('builds links with the fork scheme and reads them back', () => {
        const href = entityHref('user', 'usr_a');
        expect(href).toBe('vrcx-0-nanashi://user/open?id=usr_a');
        expect(parseEntityHref(href)).toEqual({ kind: 'user', id: 'usr_a' });
    });

    it('still reads links saved with the older vrcx-0:// scheme', () => {
        expect(parseEntityHref('vrcx-0://world/open?id=wrld_p')).toEqual({
            kind: 'world',
            id: 'wrld_p'
        });
        expect(
            parseEntityHref('https://example.com/user/open?id=x')
        ).toBeNull();
    });
});
