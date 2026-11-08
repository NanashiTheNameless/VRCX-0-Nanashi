// The fork developer badge's effect timeline: two scanlines and a set of
// glitch bursts on one shared cycle, so a burst can never drift next to a
// scan. The keyframes in src/styles/globals.css between the GENERATED
// markers come from here; edit the timings below, then run
// `npm run badges:dev-fx`. scripts/devBadgeEffects.test.ts fails when the
// stylesheet and this file disagree.

// One timeline for the scan and the glitches, in seconds.
export const CYCLE_SECONDS = 22.6;
// Percent of the cycle each glitch frame holds (about 68 ms).
const STEP = 0.3;
// Seconds the scanline takes to sweep down.
export const SCAN_SECONDS = 1.3;
// Percent of the cycle where each sweep starts.
export const SCANS = [20, 68] as const;
// Seconds with no glitch on either side of a sweep.
export const QUIET_SECONDS = 0.25;

// One glitch frame: how far the slices jump and how strongly they show, how
// the icon and label jitter, and how far the red and white copies split.
type Frame = {
    sliceX: number;
    sliceOpacity: number;
    sliceScaleY: number;
    jitterX: number;
    jitterY: number;
    redX: number;
    whiteX: number;
    ghostOpacity: number;
};

function frame(
    sliceX: number,
    sliceOpacity: number,
    sliceScaleY: number,
    jitterX: number,
    jitterY: number,
    redX: number,
    whiteX: number,
    ghostOpacity: number
): Frame {
    return {
        sliceX,
        sliceOpacity,
        sliceScaleY,
        jitterX,
        jitterY,
        redX,
        whiteX,
        ghostOpacity
    };
}

const BIG = [
    frame(-3, 1, 1, 1, 0, -2, 2, 0.9),
    frame(4, 0.85, 0.8, -1, 0.5, -3, 3, 0.9),
    frame(-2, 1, 1, 1, -0.5, -1.5, 1.5, 0.7)
];
const HUGE = [
    frame(5, 1, 0.9, -1, 0, -3, 3, 0.95),
    frame(-4, 0.9, 1, 1, 0.5, -2, 2.5, 0.9),
    frame(2, 1, 0.7, -1, -0.5, -3.5, 2, 0.85),
    frame(-1, 0.7, 1, 1, 0, -1, 1, 0.5)
];
const MID = [
    frame(-4, 0.9, 1, 1, 0.5, -2.5, 2.5, 0.8),
    frame(3, 0.8, 0.8, -1, 0, -1.5, 2, 0.6)
];
const MID2 = [
    frame(-3, 0.7, 1, 1, -0.5, -2, 1.5, 0.6),
    frame(2, 0.9, 0.7, -1, 0, -3, 2.5, 0.85)
];
const FLICK = [frame(2, 0.6, 0.6, -1, 0, -1.5, 1.5, 0.5)];
const FLICK2 = [frame(-3, 0.75, 1, 1, 0, -2, 2, 0.6)];
const TINY = [frame(2, 0.5, 1, 1, 0, -1, 1, 0.4)];
const JOLT = [frame(4, 0.9, 0.8, -1, 0, -2.5, 2.5, 0.8)];

// Where each burst starts, in percent of the cycle, and its frames. Uneven
// gaps and strengths keep the pattern from feeling like a beat.
export const BURSTS: readonly (readonly [number, readonly Frame[]])[] = [
    [3.5, BIG],
    [6.5, TINY],
    [9, MID],
    [14.5, FLICK],
    [18.55, FLICK],
    [26.95, FLICK2],
    [30.5, FLICK],
    [31.8, FLICK2],
    [36, HUGE],
    [38, JOLT],
    [43, MID2],
    [46, TINY],
    [49, FLICK2],
    [51.5, MID],
    [55, BIG],
    [60.5, TINY],
    [63.5, MID2],
    [66.25, MID2],
    [74.95, TINY],
    [78.5, MID],
    [81, FLICK],
    [83, TINY],
    [86.5, HUGE],
    [88.6, FLICK2],
    [90.8, TINY],
    [93, MID2],
    [97.5, FLICK]
];

const percentOf = (seconds: number) => (seconds / CYCLE_SECONDS) * 100;
const burstEnd = ([start, frames]: (typeof BURSTS)[number]) =>
    start + frames.length * STEP;

// Seconds of quiet before and after each scan.
export function scanGaps(): { before: number; after: number }[] {
    return SCANS.map((scan) => {
        const end = scan + percentOf(SCAN_SECONDS);
        const before = Math.min(
            ...BURSTS.filter(([start]) => start < scan).map(
                (burst) => scan - burstEnd(burst)
            )
        );
        const after = Math.min(
            ...BURSTS.filter(([start]) => start > end).map(
                ([start]) => start - end
            )
        );
        return {
            before: (before / 100) * CYCLE_SECONDS,
            after: (after / 100) * CYCLE_SECONDS
        };
    });
}

// Problems with the timeline; empty when the rules hold.
export function timelineProblems(): string[] {
    const problems: string[] = [];
    scanGaps().forEach(({ before, after }, index) => {
        if (before < QUIET_SECONDS - 1e-9 || after < QUIET_SECONDS - 1e-9) {
            problems.push(
                `scan ${index + 1} has ${before.toFixed(2)}s before and ${after.toFixed(2)}s after; at least ${QUIET_SECONDS}s is needed on each side`
            );
        }
    });
    for (let index = 1; index < BURSTS.length; index += 1) {
        if (burstEnd(BURSTS[index - 1]) >= BURSTS[index][0]) {
            problems.push(
                `burst at ${BURSTS[index][0]}% overlaps the one before`
            );
        }
    }
    const last = BURSTS.at(-1);
    if (last && burstEnd(last) > 100) {
        problems.push(`burst at ${last[0]}% runs past the end of the cycle`);
    }
    return problems;
}

const pct = (value: number) => `${Number(value.toFixed(2))}%`;
const round2 = (value: number) => Math.round(value * 100) / 100;

type Stop = readonly [string, readonly string[]];

function keyframes(name: string, stops: readonly Stop[]): string {
    const body = stops
        .map(
            ([at, lines]) =>
                `    ${at} {\n${lines.map((line) => `        ${line};\n`).join('')}    }\n`
        )
        .join('');
    return `@keyframes ${name} {\n${body}}\n`;
}

function burstStops(
    rest: readonly string[],
    toLines: (frame: Frame) => readonly string[]
): Stop[] {
    const stops: Stop[] = [['0%', rest]];
    for (const [start, frames] of BURSTS) {
        frames.forEach((each, index) => {
            stops.push([pct(start + index * STEP), toLines(each)]);
        });
        stops.push([pct(start + frames.length * STEP), rest]);
    }
    stops.push(['100%', rest]);
    return stops;
}

export function buildKeyframes(): string {
    const top = ['transform: translateY(-100%)'];
    const scan: Stop[] = [['0%', top]];
    for (const start of SCANS) {
        const end = start + percentOf(SCAN_SECONDS);
        scan.push(
            [pct(start), top],
            [pct(end), ['transform: translateY(100%)']],
            // Back to the top while it is out of sight below the badge.
            [pct(end + 0.01), top]
        );
    }
    scan.push(['100%', top]);

    const hidden = ['opacity: 0', 'transform: translateX(0)'];
    // The rim breathes unevenly; at each burst it jumps to a flare, held
    // from just before it, then eases back down.
    const rimPoints = new Map<number, number>([
        [0, 0.3],
        [24, 0.55],
        [47, 0.45],
        [72, 0.55],
        [100, 0.3]
    ]);
    for (const burst of BURSTS) {
        const [start, frames] = burst;
        const flare = frames.length > 2 ? 1 : frames.length > 1 ? 0.8 : 0.65;
        rimPoints.set(round2(start - 0.15), 0.4);
        rimPoints.set(round2(start), flare);
        rimPoints.set(round2(burstEnd(burst) + 1.5), 0.35);
    }
    const rim: Stop[] = [...rimPoints.entries()]
        .sort(([a], [b]) => a - b)
        .map(([at, opacity]) => [pct(at), [`opacity: ${opacity}`]]);

    return [
        keyframes('fork-dev-scan', scan),
        keyframes(
            'fork-dev-glitch',
            burstStops(hidden, (f) => [
                `opacity: ${f.sliceOpacity}`,
                `transform: translateX(${f.sliceX}px) scaleY(${f.sliceScaleY})`
            ])
        ),
        keyframes(
            'fork-dev-jitter',
            burstStops(['transform: translate(0, 0)'], (f) => [
                `transform: translate(${f.jitterX}px, ${f.jitterY}px)`
            ])
        ),
        keyframes(
            'fork-dev-split-red',
            burstStops(hidden, (f) => [
                `opacity: ${f.ghostOpacity}`,
                `transform: translateX(${f.redX}px)`
            ])
        ),
        keyframes(
            'fork-dev-split-white',
            burstStops(hidden, (f) => [
                `opacity: ${round2(f.ghostOpacity * 0.85)}`,
                `transform: translateX(${f.whiteX}px)`
            ])
        ),
        keyframes('fork-dev-rim', rim)
    ].join('\n');
}

export const START_MARKER =
    '/* GENERATED by scripts/devBadgeEffects.ts (npm run badges:dev-fx). Edit the timings there. */';
export const END_MARKER = '/* END GENERATED developer badge keyframes */';

const TIMINGS: readonly (readonly [string, string])[] = [
    ['scan', 'ease-in-out'],
    ['glitch', 'steps(1, end)'],
    ['jitter', 'steps(1, end)'],
    ['split-red', 'steps(1, end)'],
    ['split-white', 'steps(1, end)'],
    ['rim', 'ease-in-out']
];

// The stylesheet with the generated keyframes and every animation that uses
// them set to the shared cycle.
export function applyToStylesheet(css: string): string {
    const problems = timelineProblems();
    if (problems.length) {
        throw new Error(problems.join('\n'));
    }
    const start = css.indexOf(START_MARKER);
    const end = css.indexOf(END_MARKER);
    if (start < 0 || end < start) {
        throw new Error('The generated keyframe markers are missing.');
    }
    let next = `${css.slice(0, start)}${START_MARKER}\n${buildKeyframes()}${css.slice(end)}`;
    for (const [name, timing] of TIMINGS) {
        const pattern = new RegExp(`animation: fork-dev-${name} [^;]*;`, 'g');
        const matches = next.match(pattern)?.length ?? 0;
        if (matches !== 1) {
            throw new Error(
                `Expected one fork-dev-${name} animation, found ${matches}.`
            );
        }
        next = next.replace(
            pattern,
            `animation: fork-dev-${name} ${CYCLE_SECONDS}s ${timing} infinite;`
        );
    }
    return next;
}

// Whitespace-insensitive, so formatting the stylesheet never fails the check.
export function sameIgnoringWhitespace(a: string, b: string): boolean {
    const squash = (text: string) => text.replace(/\s+/g, '');
    return squash(a) === squash(b);
}
