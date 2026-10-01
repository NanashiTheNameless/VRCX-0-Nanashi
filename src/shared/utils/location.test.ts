import { describe, expect, it } from 'vitest';

import {
    displayLocation,
    parseLocation,
    resolveRegion,
    translateAccessType
} from './location';
import parserParityCases from './locationParserParityCases.json';

describe('location parser', () => {
    it('matches the shared Rust parser contract', () => {
        for (const { name, tag, expected } of parserParityCases) {
            expect(parseLocation(tag), name).toEqual(expected);
        }
    });

    it('trims raw tags before canonical parsing', () => {
        expect(parseLocation('  wrld_spaced:12345~region(jp)  ')).toMatchObject(
            {
                tag: 'wrld_spaced:12345~region(jp)',
                worldId: 'wrld_spaced',
                instanceId: '12345~region(jp)',
                region: 'jp'
            }
        );
    });

    it('normalizes sentinel locations', () => {
        expect(parseLocation('offline:offline')).toMatchObject({
            isOffline: true,
            isPrivate: false,
            isTraveling: false,
            worldId: ''
        });
        expect(parseLocation('private')).toMatchObject({
            isPrivate: true,
            worldId: ''
        });
        expect(parseLocation('traveling:traveling')).toMatchObject({
            isTraveling: true,
            worldId: ''
        });
    });

    it('parses invite-plus instance tags', () => {
        const parsed = parseLocation(
            'wrld_123:12345~private(usr_abc)~canRequestInvite~region(eu)'
        );

        expect(parsed).toMatchObject({
            isRealInstance: true,
            worldId: 'wrld_123',
            instanceId: '12345~private(usr_abc)~canRequestInvite~region(eu)',
            instanceName: '12345',
            accessType: 'invite+',
            accessTypeName: 'invite+',
            userId: 'usr_abc',
            privateId: 'usr_abc',
            canRequestInvite: true,
            region: 'eu'
        });
    });

    it('parses group instance tags with group access metadata', () => {
        const parsed = parseLocation(
            'wrld_123:group1~group(grp_abc)~groupAccessType(plus)~ageGate~region(jp)'
        );

        expect(parsed).toMatchObject({
            worldId: 'wrld_123',
            instanceName: 'group1',
            accessType: 'group',
            accessTypeName: 'groupPlus',
            groupId: 'grp_abc',
            groupAccessType: 'plus',
            ageGate: true,
            region: 'jp'
        });
    });

    it('keeps short name query data outside the instance id', () => {
        const parsed = parseLocation(
            'wrld_123:instance1~region(us)&shortName=abc123'
        );

        expect(parsed.instanceId).toBe('instance1~region(us)');
        expect(parsed.shortName).toBe('abc123');
        expect(parsed.region).toBe('us');
    });

    it('normalizes VRChat launch URLs before parsing', () => {
        const parsed = parseLocation(
            'https://vrchat.com/home/launch?worldId=wrld_123&instanceId=instance1~hidden(usr_abc)~region(jp)&shortName=abc123'
        );

        expect(parsed).toMatchObject({
            worldId: 'wrld_123',
            instanceId: 'instance1~hidden(usr_abc)~region(jp)',
            hiddenId: 'usr_abc',
            shortName: 'abc123',
            region: 'jp'
        });
    });

    it('normalizes vrchat launch scheme URLs before parsing', () => {
        const parsed = parseLocation(
            'vrchat://launch?id=wrld_123%3Ainstance1~region(us)&shortName=abc123'
        );

        expect(parsed).toMatchObject({
            worldId: 'wrld_123',
            instanceId: 'instance1~region(us)',
            shortName: 'abc123',
            region: 'us'
        });
    });

    it('prefers full backend parsed location objects over raw fallback fields', () => {
        const parsed = parseLocation({
            location: 'wrld_stale:1',
            $location: {
                tag: 'wrld_backend:2~group(grp_backend)~groupAccessType(plus)',
                isOffline: false,
                isPrivate: false,
                isTraveling: false,
                isRealInstance: true,
                worldId: 'wrld_backend',
                instanceId: '2~group(grp_backend)~groupAccessType(plus)',
                instanceName: '2',
                accessType: 'group',
                accessTypeName: 'groupPlus',
                region: '',
                shortName: '',
                userId: null,
                hiddenId: null,
                privateId: null,
                friendsId: null,
                groupId: 'grp_backend',
                groupAccessType: 'plus',
                canRequestInvite: false,
                strict: false,
                ageGate: false,
                worldName: 'Backend World'
            }
        });

        expect(parsed).toMatchObject({
            tag: 'wrld_backend:2~group(grp_backend)~groupAccessType(plus)',
            worldId: 'wrld_backend',
            instanceId: '2~group(grp_backend)~groupAccessType(plus)',
            accessType: 'group',
            accessTypeName: 'groupPlus',
            groupId: 'grp_backend',
            groupAccessType: 'plus',
            worldName: 'Backend World'
        });
    });

    it('falls back from old minimal backend location objects', () => {
        expect(
            parseLocation({
                $location: {
                    tag: 'wrld_123:instance1~hidden(usr_abc)~region(jp)',
                    worldId: 'wrld_123',
                    instanceId: 'instance1~hidden(usr_abc)~region(jp)',
                    groupId: ''
                }
            })
        ).toMatchObject({
            worldId: 'wrld_123',
            instanceId: 'instance1~hidden(usr_abc)~region(jp)',
            accessType: 'friends+',
            hiddenId: 'usr_abc',
            userId: 'usr_abc',
            region: 'jp'
        });
    });

    it('resolves default regions for real instances only', () => {
        expect(resolveRegion(parseLocation('wrld_123:instance1'))).toBe('us');
        expect(
            resolveRegion(parseLocation('wrld_123:instance1~region(jp)'))
        ).toBe('jp');
        expect(resolveRegion(parseLocation('wrld_123'))).toBe('');
        expect(resolveRegion(parseLocation('private'))).toBe('');
    });

    it('formats display text without async world lookups', () => {
        expect(displayLocation('offline', 'World')).toBe('Offline');
        expect(displayLocation('private', 'World')).toBe('Private');
        expect(displayLocation('traveling', 'World')).toBe('Traveling');
        expect(
            displayLocation('wrld_123:instance1~friends(usr_abc)', 'World')
        ).toBe('World friends');
        expect(
            displayLocation(
                'wrld_123:instance1~group(grp_abc)',
                'World',
                'Group Name'
            )
        ).toBe('World group(Group Name)');
        expect(displayLocation('wrld_123', 'World', 'Group Name')).toBe(
            'World (Group Name)'
        );
    });

    it('translates group access labels with the group prefix when needed', () => {
        const translations: Record<string, string> = {
            'access.group': 'Group',
            'access.group_plus': 'Plus',
            'access.public': 'Public'
        };
        const t = (key: string): string => translations[key] || key;
        const keyMap: Record<string, string> = {
            group: 'access.group',
            groupPlus: 'access.group_plus',
            public: 'access.public'
        };

        expect(translateAccessType('groupPlus', t, keyMap)).toBe('Group Plus');
        expect(translateAccessType('public', t, keyMap)).toBe('Public');
        expect(translateAccessType('invite+', t, keyMap)).toBe('invite+');
    });

    it('keeps full translated group subtype labels as-is', () => {
        const translations: Record<string, string> = {
            'access.group': 'Group',
            'access.group_plus': 'Group+'
        };
        const t = (key: string): string => translations[key] || key;
        const keyMap: Record<string, string> = {
            group: 'access.group',
            groupPlus: 'access.group_plus'
        };

        expect(translateAccessType('groupPlus', t, keyMap)).toBe('Group+');
    });
});
