import type { AnalysisResult, AnalysisSample, AnalyzedCut } from '~/types';


const ANALYSIS_WIDTH = 160;
const ANALYSIS_HEIGHT = 90;
const MAX_ANALYSIS_SAMPLES = 1800;
const MIN_SAMPLE_INTERVAL = 0.12;
const ADAPTIVE_WINDOW = 3;
const ADAPTIVE_RATIO = 3.0;
const MIN_CUT_SCORE = 0.16;
const MIN_CUT_DURATION = 0.7;

type HSVFrame = {
    hue: Uint8Array;
    luminance: Uint8Array;
    saturation: Uint8Array;
};

/**
 * 最初のフレームがデコードされ、動画寸法を利用できる状態まで待つ。
 * @param video 読み込み対象の動画要素
 * @param errorMessage 読み込み失敗時に表示する文言
 * @returns 動画寸法を参照できる状態で解決する Promise
 */
function waitForVideoData(video: HTMLVideoElement, errorMessage: string): Promise<void> {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const handleLoadedData = () => {
            cleanup();
            if (video.videoWidth <= 0 || video.videoHeight <= 0) {
                reject(new Error('動画の縦横サイズを取得できませんでした。'));
                return;
            }
            resolve();
        };
        const handleError = () => {
            cleanup();
            reject(new Error(errorMessage));
        };
        const cleanup = () => {
            video.removeEventListener('loadeddata', handleLoadedData);
            video.removeEventListener('error', handleError);
        };

        video.addEventListener('loadeddata', handleLoadedData, { once: true });
        video.addEventListener('error', handleError, { once: true });
    });
}

/**
 * 動画要素を指定時刻へ移動し、デコード済みのフレームを返す。
 * @param video 読み込み済みの動画要素
 * @param time 取得する時刻 (秒)
 * @returns seek 完了後に解決する Promise
 */
function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const handleSeeked = () => {
            cleanup();
            resolve();
        };
        const handleError = () => {
            cleanup();
            reject(new Error('動画のフレームを読み込めませんでした。'));
        };
        const cleanup = () => {
            video.removeEventListener('seeked', handleSeeked);
            video.removeEventListener('error', handleError);
        };

        video.addEventListener('seeked', handleSeeked, { once: true });
        video.addEventListener('error', handleError, { once: true });
        video.currentTime = Math.min(Math.max(time, 0), Math.max(video.duration - 0.001, 0));
    });
}

/**
 * RGB 画素を PySceneDetect と同じ比較軸になる HSV 成分へ変換する。
 * @param imageData 縮小済みフレームの画素
 * @returns 各画素の HSV 成分
 */
function convertToHSV(imageData: ImageData): HSVFrame {
    const pixelCount = imageData.width * imageData.height;
    const hue = new Uint8Array(pixelCount);
    const saturation = new Uint8Array(pixelCount);
    const luminance = new Uint8Array(pixelCount);

    // 浮動小数の HSV 変換は解析解像度だけに限定し、出力用フレームの画質と処理時間を分離する
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
        const sourceIndex = pixelIndex * 4;
        const red = imageData.data[sourceIndex] / 255;
        const green = imageData.data[sourceIndex + 1] / 255;
        const blue = imageData.data[sourceIndex + 2] / 255;
        const maximum = Math.max(red, green, blue);
        const minimum = Math.min(red, green, blue);
        const delta = maximum - minimum;
        let hueValue = 0;

        if (delta > 0) {
            if (maximum === red) {
                hueValue = ((green - blue) / delta) % 6;
            } else if (maximum === green) {
                hueValue = (blue - red) / delta + 2;
            } else {
                hueValue = (red - green) / delta + 4;
            }
            hueValue = (hueValue * 60 + 360) % 360;
        }

        hue[pixelIndex] = Math.round(hueValue / 360 * 255);
        saturation[pixelIndex] = maximum === 0 ? 0 : Math.round(delta / maximum * 255);
        luminance[pixelIndex] = Math.round(maximum * 255);
    }

    return { hue, saturation, luminance };
}

/**
 * 隣接フレーム間の HSV 変化量と、同一カット内の動きに使う輝度変化量を求める。
 * @param current 現在の縮小フレーム
 * @param previous 直前の縮小フレーム
 * @returns 正規化済みの内容変化量と動き量
 */
function compareFrames(current: HSVFrame, previous: HSVFrame): { change: number; motion: number } {
    let hueDifference = 0;
    let saturationDifference = 0;
    let luminanceDifference = 0;
    let changedPixelCount = 0;

    // 色相は環状値なので 0 と 255 が近接色として扱われる短い側の距離を使う
    for (let pixelIndex = 0; pixelIndex < current.hue.length; pixelIndex += 1) {
        const directHueDifference = Math.abs(current.hue[pixelIndex] - previous.hue[pixelIndex]);
        hueDifference += Math.min(directHueDifference, 256 - directHueDifference);
        saturationDifference += Math.abs(current.saturation[pixelIndex] - previous.saturation[pixelIndex]);
        const pixelLuminanceDifference = Math.abs(current.luminance[pixelIndex] - previous.luminance[pixelIndex]);
        luminanceDifference += pixelLuminanceDifference;

        // 小さな圧縮ノイズを動きとして数えず、視覚的に変化した画素の割合を残す
        if (pixelLuminanceDifference >= 18) {
            changedPixelCount += 1;
        }
    }

    const pixelCount = current.hue.length;
    const componentAverage = (hueDifference + saturationDifference + luminanceDifference) / (pixelCount * 3 * 255);
    return {
        change: componentAverage,
        motion: changedPixelCount / pixelCount * 0.65 + luminanceDifference / (pixelCount * 255) * 0.35,
    };
}

/**
 * 動画を縮小走査し、適応閾値でカット境界とカット内の動き量を求める。
 * @param file ブラウザで読み込む動画ファイル
 * @param onProgress 解析進捗を受け取るコールバック
 * @param reusableVideo 複数ファイル間でデコーダーを使い回す動画要素
 * @returns 動画寸法、解析サンプル、カット範囲
 */
export async function analyzeVideo(
    file: File,
    onProgress: (progress: number) => void,
    reusableVideo?: HTMLVideoElement,
): Promise<AnalysisResult> {
    const sourceURL = URL.createObjectURL(file);
    const video = reusableVideo ?? document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.src = sourceURL;

    try {
        await waitForVideoData(video, 'この動画形式はブラウザで読み込めません。');

        if (Number.isFinite(video.duration) === false || video.duration <= 0) {
            throw new Error('動画の長さを取得できませんでした。');
        }

        const analysisCanvas = document.createElement('canvas');
        analysisCanvas.width = ANALYSIS_WIDTH;
        analysisCanvas.height = ANALYSIS_HEIGHT;
        const analysisContext = analysisCanvas.getContext('2d', { willReadFrequently: true });
        if (analysisContext === null) {
            throw new Error('画像解析用のキャンバスを作成できませんでした。');
        }

        // 長尺動画でも走査回数へ上限を設け、端末性能に対して解析時間が際限なく伸びない間隔を選ぶ
        const sampleInterval = Math.max(MIN_SAMPLE_INTERVAL, video.duration / MAX_ANALYSIS_SAMPLES);
        const sampleCount = Math.max(2, Math.ceil(video.duration / sampleInterval));
        const samples: AnalysisSample[] = [];
        let previousFrame: HSVFrame | null = null;

        for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
            const time = Math.min(sampleIndex * sampleInterval, video.duration - 0.001);
            await seekVideo(video, time);
            analysisContext.drawImage(video, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
            const currentFrame = convertToHSV(analysisContext.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT));
            const comparison = previousFrame === null
                ? { change: 0, motion: 0 }
                : compareFrames(currentFrame, previousFrame);
            samples.push({ time, ...comparison });
            previousFrame = currentFrame;
            onProgress((sampleIndex + 1) / sampleCount * 0.72);
        }

        // 局所的に動き続ける区間では平均スコアも上がるため、突出した変化だけを境界として採用する
        const cutStartIndexes = [0];
        let previousCutTime = 0;
        for (let sampleIndex = ADAPTIVE_WINDOW; sampleIndex < samples.length - ADAPTIVE_WINDOW; sampleIndex += 1) {
            let surroundingTotal = 0;
            for (let offset = -ADAPTIVE_WINDOW; offset <= ADAPTIVE_WINDOW; offset += 1) {
                if (offset !== 0) {
                    surroundingTotal += samples[sampleIndex + offset].change;
                }
            }
            const surroundingAverage = surroundingTotal / (ADAPTIVE_WINDOW * 2);
            const adaptiveRatio = samples[sampleIndex].change / Math.max(surroundingAverage, 0.0001);
            const hasMinimumLength = samples[sampleIndex].time - previousCutTime >= MIN_CUT_DURATION;

            if (samples[sampleIndex].change >= MIN_CUT_SCORE && adaptiveRatio >= ADAPTIVE_RATIO && hasMinimumLength) {
                cutStartIndexes.push(sampleIndex);
                previousCutTime = samples[sampleIndex].time;
            }
        }

        const cuts: AnalyzedCut[] = cutStartIndexes.map((startIndex, cutIndex) => {
            const endIndex = cutStartIndexes[cutIndex + 1] ?? samples.length;
            const range = { startIndex, endIndex };
            const cutSamples = samples.slice(range.startIndex, range.endIndex);
            const duration = cutSamples.at(-1)!.time - cutSamples[0].time;
            const averageMotion = cutSamples.reduce((total, sample) => total + sample.motion, 0) / cutSamples.length;
            return {
                averageMotion,
                duration,
                endIndex,
                isStatic: averageMotion < 0.018 && duration >= 0.8,
                startIndex,
            };
        });

        onProgress(0.75);
        return {
            cuts,
            cutCount: cuts.length,
            duration: video.duration,
            samples,
            sourceHeight: video.videoHeight,
            sourceWidth: video.videoWidth,
        };
    } finally {
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(sourceURL);
    }
}

export { seekVideo, waitForVideoData };
