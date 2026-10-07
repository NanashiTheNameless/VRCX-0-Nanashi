import { describe, expect, it } from 'vitest';

import { VRCX_OPEN_RELAY_ORIGIN, parseVrcxInstanceLink } from './vrcxDeepLinks';

const UUID = '12345678-1234-1234-1234-1234567890ab';

describe('vrcxDeepLinks', () => {
    it('parses full instance identifiers and invitation tokens', () => {
        const input = {
            worldId: `wrld_${UUID}`,
            instanceId: `12345~private(usr_${UUID})~canRequestInvite~region(jp)~nonce(abc)`,
            shortName: 'token+with/symbols=',
            launchToken: 'secure/token+value='
        };
        const params = new URLSearchParams({
            instanceId: input.instanceId,
            shortName: input.shortName,
            launchToken: input.launchToken
        });
        expect(
            parseVrcxInstanceLink(
                `${VRCX_OPEN_RELAY_ORIGIN}/instance/${input.worldId}?${params}`
            )
        ).toEqual(input);
        expect(
            parseVrcxInstanceLink(
                `${VRCX_OPEN_RELAY_ORIGIN}/instance/${input.worldId}?instanceId=12345`
            )
        ).toEqual({
            worldId: input.worldId,
            instanceId: '12345',
            shortName: '',
            launchToken: ''
        });
    });

    it('rejects ambiguous or malformed instance links', () => {
        const base = `${VRCX_OPEN_RELAY_ORIGIN}/instance/wrld_${UUID}`;
        for (const link of [
            base,
            `${base}?instanceId=`,
            `${base}?instanceId=123&instanceId=456`,
            `${base}?instanceId=123&shortName=a&shortName=b`,
            `${base}?instanceId=123&launchToken=a&launchToken=b`,
            `${base}?instanceId=123&launchToken=token%00`,
            `${base}?instanceId=123%26shortName%3Devil`,
            `${base}?instanceId=123%0a`,
            `${base}?instanceId=123#fragment`,
            `${base}/extra?instanceId=123`,
            `${base.replace('open.vrcx-0.dev', 'open.vrcx-0.dev.evil')}?instanceId=123`
        ]) {
            expect(parseVrcxInstanceLink(link), link).toBeNull();
        }
        expect(
            parseVrcxInstanceLink(
                `${VRCX_OPEN_RELAY_ORIGIN}/instance/wrld_invalid?instanceId=123`
            )
        ).toBeNull();
    });
});
