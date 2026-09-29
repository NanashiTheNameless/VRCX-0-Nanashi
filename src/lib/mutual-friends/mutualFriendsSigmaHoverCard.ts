import { formatDateFilter } from '@/lib/dateTime';
import type { MutualFriendsGraphTheme } from '@/lib/mutual-friends/mutualFriendsPalette';

interface HoverCardNodeData {
    x: number;
    y: number;
    size: number;
    label?: string | null;
    fullLabel?: string;
    lastFetchedAt?: string | null;
    optedOut?: boolean;
    mutualCount?: number;
}

interface HoverCardSettings {
    labelSize?: number;
    labelFont?: string;
}

export interface HoverCardStrings {
    connections: string;
    lastFetched: string;
    unavailable: string;
}

function roundedRectPath(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
}

export function drawMutualFriendHoverCard(
    ctx: CanvasRenderingContext2D,
    data: HoverCardNodeData,
    settings: HoverCardSettings,
    theme: MutualFriendsGraphTheme,
    strings: HoverCardStrings
) {
    const title = data.fullLabel || data.label;
    if (!title) {
        return;
    }

    const fontSize = settings.labelSize ?? 12;
    const font = settings.labelFont ?? 'sans-serif';
    const smallFontSize = Math.max(9, fontSize - 2);
    const paddingX = 10;
    const paddingY = 8;
    const lineGap = 3;

    const subLines: string[] = [];
    if (Number.isFinite(data.mutualCount)) {
        subLines.push(`${data.mutualCount} ${strings.connections}`);
    }
    if (data.optedOut) {
        subLines.push(strings.unavailable);
    } else if (data.lastFetchedAt) {
        subLines.push(
            `${strings.lastFetched}: ${formatDateFilter(data.lastFetchedAt, 'long')}`
        );
    }

    ctx.textBaseline = 'middle';
    ctx.font = `600 ${fontSize}px ${font}`;
    let contentWidth = ctx.measureText(title).width;
    ctx.font = `${smallFontSize}px ${font}`;
    for (const line of subLines) {
        contentWidth = Math.max(contentWidth, ctx.measureText(line).width);
    }

    const width = contentWidth + paddingX * 2;
    const subBlockHeight = subLines.length
        ? lineGap +
          subLines.length * smallFontSize +
          (subLines.length - 1) * lineGap
        : 0;
    const height = paddingY * 2 + fontSize + subBlockHeight;
    const x = data.x + data.size + 6;
    const y = data.y - height / 2;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = theme.hoverCardBackground;
    roundedRectPath(ctx, x, y, width, height, 8);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = theme.hoverCardBorder;
    ctx.lineWidth = 1;
    roundedRectPath(ctx, x + 0.5, y + 0.5, width - 1, height - 1, 8);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = theme.hoverCardForeground;
    ctx.font = `600 ${fontSize}px ${font}`;
    ctx.fillText(title, x + paddingX, y + paddingY + fontSize / 2);

    ctx.font = `${smallFontSize}px ${font}`;
    ctx.fillStyle = theme.hoverCardMutedForeground;
    const subTop = y + paddingY + fontSize + lineGap;
    subLines.forEach((line, index) => {
        ctx.fillText(
            line,
            x + paddingX,
            subTop + smallFontSize / 2 + index * (smallFontSize + lineGap)
        );
    });
}
