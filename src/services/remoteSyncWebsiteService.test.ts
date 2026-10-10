import { describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({
    getString: vi.fn().mockResolvedValue('https://vrcx.namelessnanashi.dev')
}));

vi.mock('@/repositories/configRepository', () => ({ default: config }));

import {
    buildAvatarRelayUrl,
    buildInstanceRelayUrl,
    buildWorldRelayUrl,
    normalizeWebsiteOrigin
} from './remoteSyncWebsiteService';

const WORLD_ID = 'wrld_12345678-1234-1234-1234-1234567890ab';
const AVATAR_ID = 'avtr_12345678-1234-1234-1234-1234567890ab';

describe('RemoteSync website links', () => {
    it('builds the new world relay with URL-encoded preview data in the fragment', async () => {
        const link = new URL(
            await buildWorldRelayUrl({
                worldId: WORLD_ID,
                name: 'World & Name',
                author: 'Creator',
                imageUrl: 'https://api.vrchat.cloud/image/file.png'
            })
        );

        expect(link.origin).toBe('https://vrcx.namelessnanashi.dev');
        expect(link.pathname).toBe(`/open/world/${WORLD_ID}`);
        expect(link.hash).toContain('n=World+%26+Name');
        expect(link.hash).toContain('a=Creator');
        expect(link.hash).toContain('i=https%3A%2F%2Fapi.vrchat.cloud');
        expect(link.search).toBe('');
    });

    it('drops untrusted preview images and limits preview text', async () => {
        const link = new URL(
            await buildAvatarRelayUrl({
                avatarId: AVATAR_ID,
                name: 'x'.repeat(250),
                imageUrl: 'https://example.com/image.png'
            })
        );
        const fragment = new URLSearchParams(link.hash.slice(1));

        expect(link.pathname).toBe(`/open/avatar/${AVATAR_ID}`);
        expect(fragment.get('n')).toHaveLength(200);
        expect(fragment.has('i')).toBe(false);
    });

    it('builds an instance relay using the new route and preserves its launch token', async () => {
        const link = new URL(
            await buildInstanceRelayUrl({
                worldId: WORLD_ID,
                instanceId: '12345~private',
                shortName: 'shortCode',
                launchToken: 'secure/token'
            })
        );
        expect(link.pathname).toBe(`/open/instance/${WORLD_ID}`);
        expect(link.searchParams.get('launchToken')).toBe('secure/token');
    });

    it('accepts only HTTPS website origins', () => {
        expect(normalizeWebsiteOrigin('https://example.com')).toBe(
            'https://example.com'
        );
        for (const value of [
            'http://example.com',
            'https://user@example.com',
            'https://example.com/path',
            'not a URL'
        ]) {
            expect(normalizeWebsiteOrigin(value)).toBeNull();
        }
    });

    it('refuses malformed entity identifiers before creating a route', async () => {
        await expect(
            buildWorldRelayUrl({ worldId: 'wrld_bad' })
        ).rejects.toThrow('invalid world ID');
        await expect(
            buildAvatarRelayUrl({ avatarId: 'avtr_bad' })
        ).rejects.toThrow('invalid avatar ID');
        await expect(
            buildInstanceRelayUrl({
                worldId: WORLD_ID,
                instanceId: 'bad?instanceId=other'
            })
        ).rejects.toThrow('invalid instance');
    });
});
