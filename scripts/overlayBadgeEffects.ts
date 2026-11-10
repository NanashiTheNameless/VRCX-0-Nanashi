const { buildKeyframes } = (await import(
    new URL('./devBadgeEffects.ts', import.meta.url).href
)) as typeof import('./devBadgeEffects');

type Stop = { at: number; value: number };
type Animation = {
    duration: number;
    delay: number;
    easing: number[] | 'steps';
    tracks: Record<string, Stop[]>;
};

function split(value: string): string[] {
    let depth = 0;
    let start = 0;
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) {
        if (value[i] === '(') depth++;
        if (value[i] === ')') depth--;
        if (value[i] === ',' && depth === 0) {
            parts.push(value.slice(start, i).trim());
            start = i + 1;
        }
    }
    return [...parts, value.slice(start).trim()];
}

function declarations(block: string): Record<string, string> {
    return Object.fromEntries(
        block
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split(';')
            .flatMap((line) => {
                const at = line.indexOf(':');
                return at < 0
                    ? []
                    : [[line.slice(0, at).trim(), line.slice(at + 1).trim()]];
            })
    );
}

function rule(css: string, selector: string): Record<string, string> {
    let result: Record<string, string> | undefined;
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selectors = match[1]
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .trim()
            .split(/,\s*/);
        if (selectors.includes(selector))
            result = { ...result, ...declarations(match[2]) };
    }
    if (!result) throw new Error(`Missing badge rule: ${selector}`);
    return result;
}

function timing(value: string) {
    const normalized = value.replace(/var\([^,]+,\s*([^)]+)\)/g, '$1');
    const times = [...normalized.matchAll(/([\d.]+)(ms|s)\b/g)].map(
        (m) => Number(m[1]) * (m[2] === 's' ? 1000 : 1)
    );
    const bezier = normalized.match(/cubic-bezier\(([^)]+)\)/);
    const easing: Animation['easing'] = normalized.includes('steps(')
        ? 'steps'
        : bezier
          ? split(bezier[1]).map(Number)
          : normalized.includes('ease-in-out')
            ? [0.42, 0, 0.58, 1]
            : normalized.includes('ease-out')
              ? [0, 0, 0.58, 1]
              : [0, 0, 1, 1];
    return { duration: times[0], delay: times[1] ?? 0, easing };
}

function values(style: Record<string, string>): Record<string, number> {
    const result: Record<string, number> = {};
    if ('opacity' in style) result.opacity = Number(style.opacity);
    if (!style.transform) return result;
    Object.assign(result, {
        x: 0,
        y: 0,
        xp: 0,
        yp: 0,
        sx: 1,
        sy: 1,
        rotate: 0,
        rotateY: 0
    });
    for (const m of style.transform.matchAll(/([a-zA-Z]+)\(([^)]+)\)/g)) {
        const args = split(m[2]);
        const first = parseFloat(args[0]);
        const percent = args[0].endsWith('%');
        switch (m[1]) {
            case 'translateX':
                result[percent ? 'xp' : 'x'] = first;
                break;
            case 'translateY':
                result[percent ? 'yp' : 'y'] = first;
                break;
            case 'translate':
                result[percent ? 'xp' : 'x'] = first;
                result[args[1]?.endsWith('%') ? 'yp' : 'y'] = parseFloat(
                    args[1] ?? '0'
                );
                break;
            case 'scale':
                result.sx = first;
                result.sy = Number(args[1] ?? first);
                break;
            case 'scaleY':
                result.sy = first;
                break;
            case 'rotate':
                result.rotate = first;
                break;
            case 'rotateY':
                result.rotateY = first;
                break;
            default:
                throw new Error(`Unsupported badge transform: ${m[0]}`);
        }
    }
    return result;
}

export function buildOverlayBadgeEffects(css: string): string {
    const source = css + '\n' + buildKeyframes();
    const animations: Record<string, Animation> = {};
    const seen = new Set<string>();
    for (const match of source.matchAll(
        /@keyframes ((?:fork-dev|upstream-dev|award)-[\w-]+)\s*\{/g
    )) {
        const name = match[1];
        if (seen.has(name)) continue;
        seen.add(name);
        let end = match.index! + match[0].length;
        let depth = 1;
        while (depth && end < source.length) {
            if (source[end] === '{') depth++;
            if (source[end] === '}') depth--;
            end++;
        }
        const body = source.slice(match.index! + match[0].length, end - 1);
        const declaration = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
            .map((m) => declarations(m[2]))
            .find((style) => style.animation?.startsWith(`${name} `));
        if (!declaration) throw new Error(`Missing timing for ${name}`);
        const base = {
            opacity: 1,
            x: 0,
            y: 0,
            xp: 0,
            yp: 0,
            sx: 1,
            sy: 1,
            rotate: 0,
            rotateY: 0,
            ...values(declaration)
        };
        const tracks: Animation['tracks'] = {};
        for (const stop of body.matchAll(
            /((?:[\d.]+%(?:\s*,\s*)?)+|from|to)\s*\{([^}]+)\}/g
        )) {
            const offsets =
                stop[1] === 'from'
                    ? [0]
                    : stop[1] === 'to'
                      ? [1]
                      : stop[1].split(',').map((at) => parseFloat(at) / 100);
            for (const [key, value] of Object.entries(
                values(declarations(stop[2]))
            )) {
                for (const at of offsets)
                    (tracks[key] ??= []).push({ at, value });
            }
        }
        for (const [key, stops] of Object.entries(tracks)) {
            stops.sort((a, b) => a.at - b.at);
            const fallback = base[key as keyof typeof base];
            if (stops[0].at !== 0) stops.unshift({ at: 0, value: fallback });
            if (stops.at(-1)!.at !== 1) stops.push({ at: 1, value: fallback });
            const identity = ['opacity', 'sx', 'sy'].includes(key) ? 1 : 0;
            if (stops.every((stop) => stop.value === identity)) {
                delete tracks[key];
            } else {
                tracks[key] = stops.filter(
                    (stop, i) =>
                        i === 0 ||
                        i === stops.length - 1 ||
                        stop.value !== stops[i - 1].value ||
                        stop.value !== stops[i + 1].value
                );
            }
        }
        animations[name] = { ...timing(declaration.animation), tracks };
    }

    const sparkles = Array.from({ length: 3 }, (_, i) =>
        ['before', 'after'].map((side) => {
            const style = rule(
                css,
                `.global-badge-fx--sparkle.global-badge-fx--n${i + 1}::${side}`
            );
            return {
                x: parseFloat(style.left) / 5,
                y: parseFloat(style.top) / 5,
                size: parseFloat(style['--star']),
                duration: parseFloat(style['--dur']) * 1000,
                delay: parseFloat(style['--delay']) * 1000
            };
        })
    ).flat();

    function colorMix(value: string): number[] {
        if (value === 'var(--award-from)') return [1, 0, 0];
        const m = value.match(
            /color-mix\(in srgb, var\(--award-from\) ([\d.]+)%, (var\(--award-to\)|#fff)\)/
        );
        if (!m) throw new Error(`Unsupported badge color: ${value}`);
        const amount = Number(m[1]) / 100;
        return m[2] === '#fff'
            ? [amount, 0, 1 - amount]
            : [amount, 1 - amount, 0];
    }

    const embers = Array.from({ length: 3 }, (_, i) =>
        ['before', 'after'].map((side) => {
            const style = rule(
                css,
                `.global-badge-fx--embers.global-badge-fx--n${i + 1}::${side}`
            );
            const dots = [
                ...style.background.matchAll(
                    /circle at ([\d.]+)% ([\d.]+)%,\s*(.*?)\s+0 ([\d.]+)px,\s*transparent ([\d.]+)px/gs
                )
            ].map((m) => ({
                x: Number(m[1]) / 5,
                y: Number(m[2]) / 5,
                color: colorMix(m[3].trim()),
                radius: Number(m[4]),
                outer: Number(m[5])
            }));
            if (dots.length !== 2)
                throw new Error('Each ember layer must contain two sparks.');
            return {
                animation: style.animation.split(' ')[0],
                ...timing(style.animation),
                dots
            };
        })
    ).flat();

    const glints = ['after', 'before'].map((side) => {
        const style = rule(css, `.upstream-dev-badge::${side}`);
        return {
            x: parseFloat(style.left),
            y: parseFloat(style.top),
            size: parseFloat(style.width),
            ...timing(style.animation)
        };
    });
    const shimmerAngle = parseFloat(
        rule(css, '.global-badge-fx--shimmer::after').background.match(
            /linear-gradient\(\s*([\d.]+)deg/
        )![1]
    );
    return (
        JSON.stringify(
            { animations, sparkles, embers, glints, shimmerAngle },
            null,
            2
        ) + '\n'
    );
}
