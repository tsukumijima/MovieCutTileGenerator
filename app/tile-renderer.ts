import { seekVideo, waitForVideoData } from '~/video-analyzer';

import type { AnalysisResult } from '~/types';


const MAX_CANVAS_WIDTH = 7680;
const MAX_CANVAS_HEIGHT = 4320;
const TARGET_ASPECT_RATIO = 16 / 9;
const CUT_COLORS = ['#65E68A', '#FFE176', '#FFAC72', '#FF8FB8', '#CF9CFF', '#86B7FF', '#6FE0E6', '#76E6A2'];

export type RenderedTile = {
    blob: Blob;
    canvas: HTMLCanvasElement;
    columns: number;
    height: number;
    rows: number;
    width: number;
};

export type TileLayout = {
    columns: number;
};

/**
 * 動画の縦横比と空きセル数から 16:9 に近い初期グリッドを選ぶ。
 * @param result 解析済みの代表フレームと動画寸法
 * @returns 自動選択した列数
 */
export function chooseTileLayout(result: AnalysisResult): TileLayout {
    if (result.sourceWidth <= 0 || result.sourceHeight <= 0) {
        throw new Error('動画の縦横サイズを取得できませんでした。');
    }
    const frameAspectRatio = result.sourceWidth / result.sourceHeight;
    const cellAspectRatio = 1 / (1 / frameAspectRatio + 0.15);
    let bestColumns = 1;
    let smallestLayoutError = Number.POSITIVE_INFINITY;

    // 縦動画と横動画を同じ評価軸へ載せ、16:9 への近さと空きセルの少なさを両立する
    for (let columns = 1; columns <= result.frames.length; columns += 1) {
        const rows = Math.ceil(result.frames.length / columns);
        const canvasAspectRatio = columns * cellAspectRatio / rows;
        const aspectError = Math.abs(Math.log(canvasAspectRatio / TARGET_ASPECT_RATIO));
        const unusedCellRatio = (columns * rows - result.frames.length) / (columns * rows);
        const layoutError = aspectError + unusedCellRatio;
        if (layoutError < smallestLayoutError) {
            smallestLayoutError = layoutError;
            bestColumns = columns;
        }
    }

    return { columns: bestColumns };
}

/**
 * 秒数を常にミリ秒まで揃えたタイムスタンプへ変換する。
 * @param seconds 動画先頭からの秒数
 * @returns 01:23:45.569 形式の時刻
 */
function formatTimestamp(seconds: number): string {
    const milliseconds = Math.round(seconds * 1000);
    const hours = Math.floor(milliseconds / 3600000);
    const minutes = Math.floor(milliseconds % 3600000 / 60000);
    const remainingSeconds = Math.floor(milliseconds % 60000 / 1000);
    const remainingMilliseconds = milliseconds % 1000;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}.${remainingMilliseconds.toString().padStart(3, '0')}`;
}

/**
 * 代表フレームを元解像度から再取得し、長辺最大 8K のタイル画像へ描画する。
 * @param file 元動画ファイル
 * @param result 低解像度解析で選ばれた代表フレーム
 * @param layout 描画に使う列数
 * @param onProgress 生成進捗を受け取るコールバック
 * @returns プレビュー用キャンバスと PNG データ
 */
export async function renderTileImage(
    file: File,
    result: AnalysisResult,
    layout: TileLayout,
    onProgress: (progress: number) => void,
): Promise<RenderedTile> {
    const frameAspectRatio = result.sourceWidth / result.sourceHeight;
    const columns = Math.max(1, Math.min(layout.columns, result.frames.length));
    const rows = Math.ceil(result.frames.length / columns);
    const maximumCellWidth = Math.min(result.sourceWidth, Math.floor(MAX_CANVAS_WIDTH / columns));
    const captionRatio = 0.15;
    const maximumCellWidthFromHeight = Math.floor(MAX_CANVAS_HEIGHT / rows / (1 / frameAspectRatio + captionRatio));
    const cellWidth = Math.max(80, Math.min(maximumCellWidth, maximumCellWidthFromHeight));
    const frameHeight = Math.round(cellWidth / frameAspectRatio);
    const captionHeight = Math.max(20, Math.round(cellWidth * captionRatio));
    const cellHeight = frameHeight + captionHeight;
    const contentWidth = cellWidth * columns;
    const contentHeight = cellHeight * rows;
    const canvas = document.createElement('canvas');

    // 16:9 は列数選択の目標として扱い、キャンバス寸法を実際に使うセル範囲と一致させる
    canvas.width = contentWidth;
    canvas.height = contentHeight;
    const context = canvas.getContext('2d');
    if (context === null) {
        throw new Error('出力画像用のキャンバスを作成できませんでした。');
    }

    context.fillStyle = '#000000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const sourceURL = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.src = sourceURL;

    try {
        await waitForVideoData(video, '出力用フレームを読み込めませんでした。');
        await document.fonts.load(`600 ${Math.max(13, Math.round(captionHeight * 0.32))}px "Open Sans"`);

        for (let frameIndex = 0; frameIndex < result.frames.length; frameIndex += 1) {
            const frame = result.frames[frameIndex];
            const column = frameIndex % columns;
            const row = Math.floor(frameIndex / columns);
            const left = column * cellWidth;
            const top = row * cellHeight;
            await seekVideo(video, frame.time);
            context.drawImage(video, left, top, cellWidth, frameHeight);

            // 黒背景と一体になるキャプション領域へ一定幅のタイムスタンプを配置する
            const timestampFontSize = Math.max(13, Math.round(captionHeight * 0.32));
            context.fillStyle = '#FFFFFF';
            context.font = `600 ${timestampFontSize}px "Open Sans", sans-serif`;
            context.textAlign = 'right';
            context.textBaseline = 'middle';
            context.fillText(formatTimestamp(frame.time), left + cellWidth - captionHeight * 0.28, top + frameHeight + captionHeight / 2);
            onProgress(0.75 + (frameIndex + 1) / result.frames.length * 0.23);
        }

        // 同じカットが折り返す場合は行ごとに枠を分割し、左右端の開放で連続性を示す
        for (let cutIndex = 0; cutIndex < result.cutCount; cutIndex += 1) {
            const frameIndexes = result.frames
                .map((frame, frameIndex) => frame.cutIndex === cutIndex ? frameIndex : -1)
                .filter((frameIndex) => frameIndex >= 0);
            if (frameIndexes.length === 0) {
                continue;
            }

            const firstRow = Math.floor(frameIndexes[0] / columns);
            const lastRow = Math.floor(frameIndexes.at(-1)! / columns);
            const color = CUT_COLORS[cutIndex % CUT_COLORS.length];
            const borderWidth = Math.max(3, Math.round(cellWidth * 0.012));
            const inset = borderWidth / 2 + 1;
            context.strokeStyle = color;
            context.lineWidth = borderWidth;
            context.lineJoin = 'round';

            for (let row = firstRow; row <= lastRow; row += 1) {
                const rowStartIndex = Math.max(frameIndexes[0], row * columns);
                const rowEndIndex = Math.min(frameIndexes.at(-1)!, (row + 1) * columns - 1);
                const startColumn = rowStartIndex % columns;
                const endColumn = rowEndIndex % columns;
                const left = startColumn * cellWidth + inset;
                const top = row * cellHeight + inset;
                const right = (endColumn + 1) * cellWidth - inset;
                const bottom = (row + 1) * cellHeight - inset;
                const isOpenLeft = row > firstRow;
                const isOpenRight = row < lastRow;

                context.beginPath();
                context.moveTo(isOpenLeft ? left - inset : left + borderWidth, top);
                context.lineTo(isOpenRight ? right + inset : right - borderWidth, top);
                if (isOpenRight === false) {
                    context.quadraticCurveTo(right, top, right, top + borderWidth);
                    context.lineTo(right, bottom - borderWidth);
                    context.quadraticCurveTo(right, bottom, right - borderWidth, bottom);
                } else {
                    // 右端が次の行へ続く区間では、下辺を別の部分パスとして始めて折り返し境界を水平線だけで描く
                    context.moveTo(right + inset, bottom);
                }
                context.lineTo(isOpenLeft ? left - inset : left + borderWidth, bottom);
                if (isOpenLeft === false) {
                    context.quadraticCurveTo(left, bottom, left, bottom - borderWidth);
                    context.lineTo(left, top + borderWidth);
                    context.quadraticCurveTo(left, top, left + borderWidth, top);
                }
                context.stroke();

                // カット名は各連続範囲の先頭だけに置き、タイムスタンプとの役割を分離する
                if (row === firstRow) {
                    const labelFontSize = Math.max(14, Math.round(captionHeight * 0.38));
                    const label = `Cut ${(cutIndex + 1).toString().padStart(2, '0')}`;
                    context.font = `700 ${labelFontSize}px "Open Sans", sans-serif`;
                    context.textAlign = 'left';
                    context.textBaseline = 'middle';
                    const labelWidth = context.measureText(label).width;
                    context.fillStyle = '#000000';
                    context.fillRect(left + borderWidth, top + frameHeight + captionHeight * 0.17, labelWidth + captionHeight * 0.45, captionHeight * 0.66);
                    context.fillStyle = color;
                    context.fillText(label, left + borderWidth + captionHeight * 0.18, top + frameHeight + captionHeight / 2);
                }
            }
        }

        const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((generatedBlob) => {
                if (generatedBlob === null) {
                    reject(new Error('PNG 画像を生成できませんでした。'));
                    return;
                }
                resolve(generatedBlob);
            }, 'image/png');
        });
        onProgress(1);
        return { blob, canvas, columns, height: canvas.height, rows, width: canvas.width };
    } finally {
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(sourceURL);
    }
}
