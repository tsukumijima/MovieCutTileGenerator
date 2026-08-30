import type { AnalysisResult, AnalyzedCut, FramePlan, FramePlanOptions, SelectedFrame } from '~/types';


const TARGET_ASPECT_RATIO = 16 / 9;
const CAPTION_RATIO = 0.15;
const MAX_FRAME_COUNT = 160;

function getMaximumFrameCount(cut: AnalyzedCut): number {
    const sampleCount = Math.max(1, cut.endIndex - cut.startIndex - (cut.isStatic ? 0 : 1));
    const temporalLimit = Math.max(cut.isStatic ? 1 : 2, Math.ceil(cut.duration / 0.35) + 1);
    return Math.min(sampleCount, temporalLimit);
}

function getNaturalFrameCount(cut: AnalyzedCut): number {
    if (cut.isStatic) {
        return 1;
    }
    const targetInterval = cut.averageMotion >= 0.15 ? 0.5 : cut.averageMotion >= 0.07 ? 0.75 : 1.1;
    return Math.min(getMaximumFrameCount(cut), Math.max(2, Math.ceil(cut.duration / targetInterval) + 1));
}

function chooseGrid(result: AnalysisResult, desiredFrameCount: number, requestedColumns?: number): { columns: number; rows: number } {
    const boundedCount = Math.max(result.cutCount, Math.min(desiredFrameCount, MAX_FRAME_COUNT));
    if (requestedColumns !== undefined) {
        const columns = Math.max(1, Math.min(Math.round(requestedColumns), boundedCount));
        return { columns, rows: Math.ceil(boundedCount / columns) };
    }

    const frameAspectRatio = result.sourceWidth / result.sourceHeight;
    const cellAspectRatio = 1 / (1 / frameAspectRatio + CAPTION_RATIO);
    let bestColumns = 1;
    let bestRows = boundedCount;
    let smallestError = Number.POSITIVE_INFINITY;

    for (let columns = 1; columns <= boundedCount; columns += 1) {
        const rows = Math.ceil(boundedCount / columns);
        const capacity = columns * rows;
        const canvasAspectRatio = columns * cellAspectRatio / rows;
        const aspectError = Math.abs(Math.log(canvasAspectRatio / TARGET_ASPECT_RATIO));
        const addedFrameRatio = (capacity - boundedCount) / boundedCount;
        const layoutError = aspectError + addedFrameRatio * 0.4;
        if (layoutError < smallestError) {
            smallestError = layoutError;
            bestColumns = columns;
            bestRows = rows;
        }
    }

    return { columns: bestColumns, rows: bestRows };
}

function allocateFrames(result: AnalysisResult, targetCount: number): number[] {
    const allocations = result.cuts.map((cut) => Math.min(getMaximumFrameCount(cut), cut.isStatic ? 1 : 2));
    const maximumCounts = result.cuts.map(getMaximumFrameCount);
    let allocatedCount = allocations.reduce((total, count) => total + count, 0);

    while (allocatedCount < targetCount) {
        let bestCutIndex = -1;
        let bestGain = Number.NEGATIVE_INFINITY;
        for (let cutIndex = 0; cutIndex < result.cuts.length; cutIndex += 1) {
            if (allocations[cutIndex] >= maximumCounts[cutIndex]) {
                continue;
            }
            const cut = result.cuts[cutIndex];
            const nextCount = allocations[cutIndex] + 1;
            const motionWeight = 0.55 + Math.min(cut.averageMotion, 0.25) * 5;
            const coverageGain = cut.duration / nextCount * motionWeight;
            if (coverageGain > bestGain) {
                bestGain = coverageGain;
                bestCutIndex = cutIndex;
            }
        }
        if (bestCutIndex < 0) {
            break;
        }
        allocations[bestCutIndex] += 1;
        allocatedCount += 1;
    }

    return allocations;
}

function selectCutFrames(result: AnalysisResult, cutIndex: number, frameCount: number): SelectedFrame[] {
    const cut = result.cuts[cutIndex];
    if (frameCount === 1) {
        const middleIndex = Math.floor((cut.startIndex + cut.endIndex - 1) / 2);
        return [{ cutIndex, time: result.samples[middleIndex].time }];
    }

    const firstSafeIndex = Math.min(cut.startIndex + 1, cut.endIndex - 1);
    const lastIndex = cut.endIndex - 1;
    const frames: SelectedFrame[] = [];
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        const ratio = frameCount === 1 ? 0.5 : frameIndex / (frameCount - 1);
        const sampleIndex = Math.round(firstSafeIndex + (lastIndex - firstSafeIndex) * ratio);
        const time = result.samples[sampleIndex].time;
        if (frames.at(-1)?.time !== time) {
            frames.push({ cutIndex, time });
        }
    }
    return frames;
}

export function getAutomaticFrameCount(result: AnalysisResult): number {
    return Math.min(MAX_FRAME_COUNT, result.cuts.reduce((total, cut) => total + getNaturalFrameCount(cut), 0));
}

export function getFrameCountLimit(result: AnalysisResult): number {
    return Math.min(MAX_FRAME_COUNT, result.cuts.reduce((total, cut) => total + getMaximumFrameCount(cut), 0));
}

/**
 * 各カットの動きと長さから、完成グリッドを埋める代表フレームを選ぶ。
 * @param result 低解像度解析で得たカットと動き量
 * @param options 自動選択または枚数指定と、任意の列数
 * @returns 空きセルのないグリッドと代表フレーム
 */
export function createFramePlan(result: AnalysisResult, options: FramePlanOptions): FramePlan {
    const automaticFrameCount = getAutomaticFrameCount(result);
    const desiredFrameCount = options.mode === 'fixed'
        ? Math.max(result.cutCount, options.targetCount ?? automaticFrameCount)
        : automaticFrameCount;
    const grid = chooseGrid(result, desiredFrameCount, options.columns);
    const maximumFrameCount = getFrameCountLimit(result);
    const gridCapacity = grid.columns * grid.rows;
    const targetCount = Math.min(maximumFrameCount, gridCapacity);
    const allocations = allocateFrames(result, targetCount);
    const frames = allocations.flatMap((frameCount, cutIndex) => selectCutFrames(result, cutIndex, frameCount));

    if (frames.length !== gridCapacity) {
        const adjustedGrid = chooseGrid(result, frames.length, options.columns);
        return { ...adjustedGrid, frames };
    }
    return { ...grid, frames };
}
