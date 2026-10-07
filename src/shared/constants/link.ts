import { vrchatPasswordUrl, vrchatRegisterUrl } from './vrchatWebUrls';

const links: Record<string, string> = {
    wiki: 'https://github.com/Map1en/VRCX-0/wiki',
    github: 'https://github.com/NanashiTheNameless/VRCX-0-Nanashi',
    githubSponsors: 'https://github.com/sponsors/NanashiTheNameless',
    buyMeACoffee: 'https://buymeacoffee.com/NamelessNanashi',
    kofi: 'https://ko-fi.com/NanashiTheNameless',
    liberapay: 'https://liberapay.com/NamelessNanashi',
    throne: 'https://throne.com/NamelessNanashi',
    upstreamGithub: 'https://github.com/Map1en/VRCX-0',
    issues: 'https://github.com/NanashiTheNameless/VRCX-0-Nanashi/issues',
    releases: 'https://github.com/NanashiTheNameless/VRCX-0-Nanashi/releases',
    contributorsApi:
        'https://api.github.com/repos/NanashiTheNameless/VRCX-0-Nanashi/contributors?per_page=100',
    license:
        'https://github.com/NanashiTheNameless/VRCX-0-Nanashi/blob/master/LICENSE',
    vrchatStatus: 'https://status.vrchat.com/',
    vrchatDocsConfigurationFile:
        'https://docs.vrchat.com/docs/configuration-file',
    vrchatDocsLaunchOptions: 'https://docs.vrchat.com/docs/launch-options',
    vrchatPassword: vrchatPasswordUrl(),
    vrchatRegister: vrchatRegisterUrl(),
    communityThemesRepository:
        'https://github.com/Map1en/VRCX-0-Community-Themes',
    communityThemesIndex:
        'https://raw.githubusercontent.com/Map1en/VRCX-0-Community-Themes/master/themes/index.json'
};

export { links };
