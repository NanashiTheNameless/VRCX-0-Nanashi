import { useQuery } from '@tanstack/react-query';

import externalApiRepository from '@/repositories/externalApiRepository';
import { links } from '@/shared/constants/link';
import { HOUR_MS } from '@/shared/constants/time';
import { isRecord } from '@/shared/utils/record';

export type AboutContributor = {
    login: string;
    avatarUrl: string;
    profileUrl: string;
};

export type AboutContributorRole = 'fork_maintainer' | 'upstream_developer';

export type AboutCreditedPerson = AboutContributor & {
    role: AboutContributorRole;
};

// Rendered at 44px; 88px keeps avatars sharp on HiDPI while staying tiny.
const AVATAR_SIZE_PX = 88;

export const ABOUT_CREDITED_PEOPLE: readonly AboutCreditedPerson[] = [
    {
        login: 'NanashiTheNameless',
        avatarUrl: sizedAvatarUrl(
            'https://avatars.githubusercontent.com/NanashiTheNameless'
        ),
        profileUrl: 'https://github.com/NanashiTheNameless',
        role: 'fork_maintainer'
    },
    {
        login: 'Map1en',
        avatarUrl: sizedAvatarUrl(
            'https://avatars.githubusercontent.com/Map1en'
        ),
        profileUrl: 'https://github.com/Map1en',
        role: 'upstream_developer'
    }
];

const CREDITED_LOGINS = new Set(
    ABOUT_CREDITED_PEOPLE.map((person) => person.login.toLowerCase())
);

export function sizedAvatarUrl(url: string): string {
    if (!url) {
        return url;
    }
    try {
        const parsed = new URL(url);
        parsed.searchParams.set('s', String(AVATAR_SIZE_PX));
        return parsed.toString();
    } catch {
        return url;
    }
}

function isBotContributor(entry: Record<string, unknown>): boolean {
    return (
        entry.type === 'Bot' ||
        entry.login === 'fossabot' ||
        String(entry.login || '').endsWith('[bot]')
    );
}

function parseContributors(data: string): AboutContributor[] {
    const parsed: unknown = JSON.parse(data);
    if (!Array.isArray(parsed)) {
        throw new Error('GitHub contributors payload is not a list.');
    }
    return parsed
        .filter(isRecord)
        .filter((entry) => !isBotContributor(entry))
        .map((entry) => ({
            login: String(entry.login || ''),
            avatarUrl: sizedAvatarUrl(String(entry.avatar_url || '')),
            profileUrl: String(entry.html_url || '')
        }))
        .filter(
            (entry) =>
                entry.login && !CREDITED_LOGINS.has(entry.login.toLowerCase())
        );
}

export function useAboutContributors(enabled: boolean) {
    return useQuery({
        queryKey: ['about-contributors'],
        queryFn: async () => {
            const response =
                await externalApiRepository.fetchGithubContributors({
                    url: links.contributorsApi,
                    headers: { Accept: 'application/vnd.github+json' }
                });
            if (response.status !== 200) {
                throw new Error(
                    `GitHub contributors request failed (${response.status}).`
                );
            }
            return parseContributors(response.data);
        },
        enabled,
        staleTime: 6 * HOUR_MS,
        retry: 1,
        refetchOnWindowFocus: false
    });
}
