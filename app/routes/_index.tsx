import { Button, Progress, Slider, Spinner } from '@heroui/react';
import { Icon } from '@iconify-icon/react';
import { useSignal } from '@preact/signals-react';
import { useEffect, useRef } from 'react';

import { createFramePlan, getAutomaticFrameCount, getFrameCountLimit } from '~/frame-selector';
import { renderTileImage, type RenderedTile } from '~/tile-renderer';
import { analyzeVideo } from '~/video-analyzer';

import type { AnalysisResult, FramePlan, OutputFormat } from '~/types';


type JobStatus = 'analyzing' | 'complete' | 'error' | 'queued' | 'rendering';

type VideoJob = {
    analysis: AnalysisResult | null;
    columns: number;
    error: string;
    file: File;
    frameMode: 'auto' | 'fixed';
    id: string;
    plan: FramePlan | null;
    planRevision: number;
    previewURL: string | null;
    progress: number;
    renderedRevision: number;
    renderedTile: RenderedTile | null;
    status: JobStatus;
    targetCount: number;
};

type WritableDirectoryHandle = {
    getFileHandle: (name: string, options: { create: true }) => Promise<WritableFileHandle>;
};

type WritableFileHandle = {
    createWritable: () => Promise<WritableFileStream>;
};

type WritableFileStream = {
    close: () => Promise<void>;
    write: (data: Blob) => Promise<void>;
};

type DirectoryPickerWindow = Window & {
    showDirectoryPicker?: (options: {
        id: string;
        mode: 'readwrite';
        startIn: 'downloads';
    }) => Promise<WritableDirectoryHandle>;
};

const CUT_COLORS = ['#65E68A', '#FFE176', '#FFAC72', '#FF8FB8', '#CF9CFF', '#86B7FF'];
const DOWNLOAD_BATCH_SIZE = 10;

function formatFileSize(bytes: number): string {
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function getExtension(format: OutputFormat): string {
    return format === 'png' ? 'png' : 'jpg';
}

function getDownloadName(file: File, format: OutputFormat): string {
    const baseName = file.name.replace(/\.[^.]+$/, '');
    return `${baseName}.movie-cut-tile.${getExtension(format)}`;
}

function startDownload(blob: Blob, fileName: string): void {
    const downloadURL = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = downloadURL;
    anchor.download = fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(downloadURL), 1000);
}

function getStatusLabel(status: JobStatus): string {
    if (status === 'queued') return '待機中';
    if (status === 'analyzing') return '解析中';
    if (status === 'rendering') return '画像生成中';
    if (status === 'complete') return '完了';
    return 'エラー';
}

/** @useSignals */
export default function Index() {
    const jobs = useSignal<VideoJob[]>([]);
    const selectedJobID = useSignal<string | null>(null);
    const outputFormat = useSignal<OutputFormat>('jpeg');
    const jpegQuality = useSignal(0.92);
    const isDragging = useSignal(false);
    const isBatchRegenerating = useSignal(false);
    const isBatchSaving = useSignal(false);
    const batchDownloadOffset = useSignal(0);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const reusableVideoRef = useRef<HTMLVideoElement | null>(null);
    const processingQueueRef = useRef<Promise<void>>(Promise.resolve());

    /**
     * すべての解析と描画で共有する動画要素を返す。
     * @returns ブラウザのデコーダーを再利用する動画要素
     */
    const getReusableVideo = (): HTMLVideoElement => {
        if (reusableVideoRef.current === null) {
            const video = document.createElement('video');
            video.playsInline = true;
            video.style.position = 'fixed';
            video.style.width = '1px';
            video.style.height = '1px';
            video.style.opacity = '0';
            video.style.pointerEvents = 'none';
            document.body.append(video);
            reusableVideoRef.current = video;
        }
        return reusableVideoRef.current;
    };

    const updateJob = (jobID: string, update: Partial<VideoJob>) => {
        jobs.value = jobs.value.map((job) => job.id === jobID ? { ...job, ...update } : job);
    };

    const renderJob = async (jobID: string, sourceJob?: VideoJob) => {
        const job = sourceJob ?? jobs.peek().find((candidate) => candidate.id === jobID);
        if (job?.analysis === null || job?.analysis === undefined || job.plan === null) {
            return;
        }
        const format = outputFormat.peek();
        const quality = jpegQuality.peek();
        updateJob(jobID, { error: '', progress: 0.75, status: 'rendering' });

        try {
            const tile = await renderTileImage(job.file, job.analysis, job.plan, format, quality, (nextProgress) => {
                updateJob(jobID, { progress: nextProgress });
            }, getReusableVideo());
            const currentJob = jobs.peek().find((candidate) => candidate.id === jobID);
            if (currentJob === undefined) {
                return;
            }
            if (currentJob.previewURL !== null) {
                URL.revokeObjectURL(currentJob.previewURL);
            }
            updateJob(jobID, {
                previewURL: URL.createObjectURL(tile.blob),
                progress: 1,
                renderedRevision: job.planRevision,
                renderedTile: tile,
                status: 'complete',
            });
            batchDownloadOffset.value = 0;
        } catch (error) {
            console.error('Failed to render video tiles.', error);
            updateJob(jobID, {
                error: error instanceof Error ? error.message : 'タイル画像を生成できませんでした。',
                status: 'error',
            });
        }
    };

    const processJob = async (jobID: string) => {
        const job = jobs.peek().find((candidate) => candidate.id === jobID);
        if (job === undefined) {
            return;
        }
        updateJob(jobID, { progress: 0, status: 'analyzing' });
        try {
            const analysis = await analyzeVideo(job.file, (nextProgress) => {
                updateJob(jobID, { progress: nextProgress });
            }, getReusableVideo());
            if (jobs.peek().some((candidate) => candidate.id === jobID) === false) {
                return;
            }
            const plan = createFramePlan(analysis, { mode: 'auto' });
            const analyzedJob: VideoJob = {
                ...job,
                analysis,
                columns: plan.columns,
                plan,
                planRevision: 1,
                progress: 0.75,
                status: 'rendering',
                targetCount: getAutomaticFrameCount(analysis),
            };
            updateJob(jobID, analyzedJob);
            await renderJob(jobID, analyzedJob);
        } catch (error) {
            console.error('Failed to analyze video.', error);
            updateJob(jobID, {
                error: error instanceof Error ? error.message : '動画を解析できませんでした。',
                status: 'error',
            });
        }
    };

    const addFiles = (files: File[]) => {
        // OS が MIME タイプを渡さない動画も、選択画面に明示した拡張子なら処理対象へ含める
        const videoFiles = files.filter((file) => file.type.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(file.name));
        if (videoFiles.length === 0) {
            return;
        }
        const newJobs = videoFiles.map<VideoJob>((file) => ({
            analysis: null,
            columns: 1,
            error: '',
            file,
            frameMode: 'auto',
            id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
            plan: null,
            planRevision: 0,
            previewURL: null,
            progress: 0,
            renderedRevision: -1,
            renderedTile: null,
            status: 'queued',
            targetCount: 1,
        }));
        jobs.value = [...jobs.value, ...newJobs];
        batchDownloadOffset.value = 0;
        selectedJobID.value ??= newJobs[0].id;
        for (const job of newJobs) {
            processingQueueRef.current = processingQueueRef.current.then(() => processJob(job.id));
        }
    };

    const removeJob = (jobID: string) => {
        const job = jobs.peek().find((candidate) => candidate.id === jobID);
        if (job?.previewURL !== null && job?.previewURL !== undefined) {
            URL.revokeObjectURL(job.previewURL);
        }
        jobs.value = jobs.value.filter((candidate) => candidate.id !== jobID);
        batchDownloadOffset.value = 0;
        if (selectedJobID.value === jobID) {
            selectedJobID.value = jobs.value[0]?.id ?? null;
        }
    };

    const updateSelectedPlan = (update: Partial<Pick<VideoJob, 'columns' | 'frameMode' | 'targetCount'>>) => {
        const job = jobs.peek().find((candidate) => candidate.id === selectedJobID.peek());
        if (job?.analysis === null || job?.analysis === undefined) {
            return;
        }
        const frameMode = update.frameMode ?? job.frameMode;
        const targetCount = update.targetCount ?? job.targetCount;
        const columns = update.columns ?? job.columns;
        const plan = createFramePlan(job.analysis, {
            columns,
            mode: frameMode,
            targetCount,
        });
        updateJob(job.id, {
            columns,
            frameMode,
            plan,
            planRevision: job.planRevision + 1,
            targetCount,
        });
    };

    const regenerateAll = () => {
        isBatchRegenerating.value = true;
        processingQueueRef.current = processingQueueRef.current.then(async () => {
            for (const job of jobs.peek()) {
                if (job.analysis !== null && job.plan !== null) {
                    await renderJob(job.id, job);
                }
            }
            isBatchRegenerating.value = false;
        });
    };

    const downloadJob = (job: VideoJob) => {
        if (job.renderedTile !== null) {
            startDownload(job.renderedTile.blob, getDownloadName(job.file, job.renderedTile.format));
        }
    };

    const downloadAll = async () => {
        const completedJobs = jobs.peek().filter((job) => job.renderedTile !== null);
        const showDirectoryPicker = (window as DirectoryPickerWindow).showDirectoryPicker;

        // 保存先フォルダーへ直接書き込める環境では、自動ダウンロードの件数制限を受けずに全ファイルを保存する
        if (showDirectoryPicker !== undefined) {
            isBatchSaving.value = true;
            try {
                const directoryHandle = await showDirectoryPicker({
                    id: 'movie-cut-tiles',
                    mode: 'readwrite',
                    startIn: 'downloads',
                });
                const usedNames = new Set<string>();
                for (const job of completedJobs) {
                    const renderedTile = job.renderedTile;
                    if (renderedTile === null) {
                        continue;
                    }
                    const originalName = getDownloadName(job.file, renderedTile.format);
                    const extensionIndex = originalName.lastIndexOf('.');
                    const stem = originalName.slice(0, extensionIndex);
                    const extension = originalName.slice(extensionIndex);
                    let downloadName = originalName;
                    let duplicateIndex = 2;
                    // 別フォルダーから同名動画を追加した場合も、連番を付けて生成画像を上書きせず残す
                    while (usedNames.has(downloadName)) {
                        downloadName = `${stem} (${duplicateIndex})${extension}`;
                        duplicateIndex += 1;
                    }
                    usedNames.add(downloadName);

                    // 各 Blob を独立したファイルとして書き込み、アーカイブ展開なしで利用できる状態にする
                    const fileHandle = await directoryHandle.getFileHandle(downloadName, { create: true });
                    const writable = await fileHandle.createWritable();
                    await writable.write(renderedTile.blob);
                    await writable.close();
                }
                batchDownloadOffset.value = 0;
                return;
            } catch (error) {
                if (error instanceof DOMException && error.name === 'AbortError') {
                    return;
                }
                console.error('Failed to save all generated images to a directory.', error);
                // フォルダーへの書き込みだけが失敗した場合も、通常ダウンロードの分割保存で処理を継続する
            } finally {
                isBatchSaving.value = false;
            }
        }

        // フォルダー選択に非対応のブラウザでは、ユーザー操作ごとに Chromium の上限内で続きを保存する
        const startIndex = Math.min(batchDownloadOffset.peek(), completedJobs.length);
        const endIndex = Math.min(startIndex + DOWNLOAD_BATCH_SIZE, completedJobs.length);
        for (const job of completedJobs.slice(startIndex, endIndex)) {
            downloadJob(job);
        }
        batchDownloadOffset.value = endIndex < completedJobs.length ? endIndex : 0;
    };

    useEffect(() => () => {
        for (const job of jobs.peek()) {
            if (job.previewURL !== null) {
                URL.revokeObjectURL(job.previewURL);
            }
        }
        if (reusableVideoRef.current !== null) {
            reusableVideoRef.current.removeAttribute('src');
            reusableVideoRef.current.load();
            reusableVideoRef.current.remove();
            reusableVideoRef.current = null;
        }
    }, [jobs]);

    const selectedJob = jobs.value.find((job) => job.id === selectedJobID.value) ?? null;
    const completedCount = jobs.value.filter((job) => job.renderedTile !== null).length;
    const remainingDownloadCount = Math.max(0, completedCount - batchDownloadOffset.value);
    const batchSaveLabel = batchDownloadOffset.value > 0 ? `残り${remainingDownloadCount}件を保存` : 'すべて保存';
    const isAnyProcessing = jobs.value.some((job) => job.status === 'analyzing' || job.status === 'queued' || job.status === 'rendering');
    const isSelectedCurrent = selectedJob?.renderedTile !== null
        && selectedJob?.renderedTile !== undefined
        && selectedJob.renderedRevision === selectedJob.planRevision
        && selectedJob.renderedTile.format === outputFormat.value
        && (outputFormat.value === 'png' || selectedJob.renderedTile.jpegQuality === jpegQuality.value);
    const hasStaleOutputs = jobs.value.some((job) => job.renderedTile !== null
        && (job.renderedRevision !== job.planRevision
            || job.renderedTile.format !== outputFormat.value
            || (outputFormat.value === 'jpeg' && job.renderedTile.jpegQuality !== jpegQuality.value)));

    return (
        <main className="min-h-screen px-4 pb-24 pt-4 sm:px-6 sm:pt-6 lg:px-8 lg:pb-12">
            <header className="mx-auto flex max-w-[1500px] items-center justify-between border-b border-line pb-4">
                <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-lime/40 bg-lime/10 text-lime">
                        <Icon icon="solar:clapperboard-edit-linear" width="22" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="truncate text-xs font-semibold tracking-[0.12em] text-white sm:text-[15px] sm:tracking-[0.16em]">MOVIE CUT TILE GENERATOR</h1>
                        <p className="mt-0.5 hidden text-[10px] tracking-[0.18em] text-muted sm:block">CLIENT-SIDE SHOT OVERVIEW</p>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-[10px] text-muted sm:text-xs">
                    <Icon icon="solar:shield-check-linear" width="17" className="text-lime" />
                    <span className="hidden sm:inline">動画はブラウザ内だけで処理されます</span>
                    <span className="sm:hidden">端末内処理</span>
                </div>
            </header>

            <section className="mx-auto mt-7 max-w-[1500px] sm:mt-9">
                <div className="max-w-4xl">
                    <div className="flex items-center gap-3 text-[11px] font-semibold tracking-[0.15em] text-lime sm:text-xs">
                        <span className="h-px w-8 bg-lime" />
                        SHOT BY SHOT
                    </div>
                    <h2 className="mt-4 text-[30px] font-semibold leading-tight tracking-[-0.04em] text-white sm:text-4xl lg:text-[42px]">映像の流れを、一枚で見渡す。</h2>
                    <p className="mt-4 max-w-3xl text-sm leading-6 text-muted sm:text-[15px] sm:leading-7">似たフレームを自動で間引き、動きとカットの変化が分かる一覧画像を生成します。</p>
                    <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-muted sm:text-xs">
                        {['AI 生成映像の比較', 'MV・ショートフィルムの分析', '絵コンテ・演出の俯瞰', 'LLM への映像共有'].map((useCase) => (
                            <span key={useCase} className="rounded-full border border-line bg-panel/70 px-3 py-1.5">{useCase}</span>
                        ))}
                    </div>
                </div>

                <div className="mt-7 rounded-2xl border border-line bg-panel p-4 sm:p-5">
                    <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
                        <button
                            type="button"
                            className={`group flex min-h-28 flex-1 items-center justify-center gap-4 rounded-xl border border-dashed px-5 text-left transition sm:min-h-24 ${isDragging.value ? 'border-lime bg-lime/[0.06]' : 'border-line hover:border-lime/50 hover:bg-ink/40'}`}
                            onClick={() => fileInputRef.current?.click()}
                            onDragEnter={(event) => { event.preventDefault(); isDragging.value = true; }}
                            onDragOver={(event) => { event.preventDefault(); isDragging.value = true; }}
                            onDragLeave={(event) => { if (event.currentTarget.contains(event.relatedTarget as Node) === false) isDragging.value = false; }}
                            onDrop={(event) => {
                                event.preventDefault();
                                isDragging.value = false;
                                addFiles(Array.from(event.dataTransfer.files));
                            }}
                        >
                            <Icon icon="solar:upload-square-linear" width="34" className="shrink-0 text-lime" />
                            <div>
                                <p className="text-sm font-semibold text-white sm:text-base">動画をまとめてドロップ</p>
                                <p className="mt-1 text-xs text-muted">クリックして選択できます。MP4・MOV・WebM、複数選択に対応</p>
                            </div>
                        </button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="video/*"
                            multiple
                            className="hidden"
                            onChange={(event) => {
                                addFiles(Array.from(event.target.files ?? []));
                                event.target.value = '';
                            }}
                        />

                        <div className="flex flex-col gap-4 sm:flex-row sm:items-end xl:w-auto">
                            <div>
                                <p className="mb-2 text-[11px] font-semibold tracking-[0.12em] text-muted">OUTPUT FORMAT</p>
                                <div className="flex rounded-xl border border-line bg-ink p-1">
                                    {(['png', 'jpeg'] as const).map((format) => (
                                        <Button
                                            key={format}
                                            size="sm"
                                            variant={outputFormat.value === format ? 'solid' : 'light'}
                                            color={outputFormat.value === format ? 'primary' : 'default'}
                                            className="min-w-20"
                                            onPress={() => { outputFormat.value = format; }}
                                        >
                                            {format.toUpperCase()}
                                        </Button>
                                    ))}
                                </div>
                                <p className="mt-2 text-[10px] text-muted">{outputFormat.value === 'png' ? '可逆・最高圧縮' : `画質 ${Math.round(jpegQuality.value * 100)}%`}</p>
                            </div>
                            {outputFormat.value === 'jpeg' && (
                                <div className="min-w-48 pb-1">
                                    <Slider aria-label="JPEG 画質" color="primary" minValue={0.7} maxValue={1} step={0.01} value={jpegQuality.value} onChange={(value) => { jpegQuality.value = Array.isArray(value) ? value[0] : value; }} />
                                </div>
                            )}
                            {jobs.value.length > 0 && (
                                <div className="flex gap-2">
                                    <Button variant="bordered" className="border-line" isDisabled={isAnyProcessing} isLoading={isBatchRegenerating.value} onPress={() => { void regenerateAll(); }}>全件再生成</Button>
                                    <Button color="primary" isDisabled={completedCount === 0 || hasStaleOutputs || isAnyProcessing} isLoading={isBatchSaving.value} startContent={<Icon icon="solar:download-minimalistic-linear" width="18" />} onPress={() => { void downloadAll(); }}>{batchSaveLabel}</Button>
                                </div>
                            )}
                        </div>
                    </div>
                    {hasStaleOutputs && <p className="mt-3 text-xs text-warning">設定を変更した動画があります。全件再生成後にまとめて保存できます。</p>}
                </div>

                {jobs.value.length === 0 ? (
                    <div className="mt-6 flex min-h-56 items-center justify-center rounded-2xl border border-line bg-panel/40 px-6 text-center sm:min-h-72">
                        <div>
                            <Icon icon="solar:gallery-wide-linear" width="42" className="mx-auto text-muted" />
                            <p className="mt-4 text-sm text-muted">追加した動画のカット構成がここに表示されます。</p>
                        </div>
                    </div>
                ) : (
                    <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
                        <div className="min-w-0 space-y-5">
                            <div className="overflow-hidden rounded-2xl border border-line bg-panel shadow-glow">
                                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5 sm:py-4">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-white">{selectedJob?.file.name ?? '動画を選択してください'}</p>
                                        {selectedJob?.renderedTile !== null && selectedJob?.renderedTile !== undefined && (
                                            <p className="mt-1 text-[11px] text-muted">{selectedJob.renderedTile.width} × {selectedJob.renderedTile.height} px・{selectedJob.renderedTile.frameCount}枚</p>
                                        )}
                                    </div>
                                    {selectedJob?.renderedTile !== null && selectedJob?.renderedTile !== undefined && (
                                        <Button size="sm" color="primary" startContent={<Icon icon="solar:download-minimalistic-linear" width="17" />} onPress={() => downloadJob(selectedJob)}>単独保存</Button>
                                    )}
                                </div>
                                <div className="checkerboard flex min-h-64 items-center justify-center overflow-auto p-3 sm:min-h-[430px] sm:p-6">
                                    {selectedJob?.previewURL !== null && selectedJob?.previewURL !== undefined ? (
                                        <img src={selectedJob.previewURL} alt="生成されたカットタイル" className="max-h-[640px] max-w-full object-contain shadow-2xl" />
                                    ) : selectedJob?.status === 'error' ? (
                                        <div className="max-w-md text-center text-danger-300"><Icon icon="solar:danger-triangle-linear" width="32" className="mx-auto" /><p className="mt-3 text-sm">{selectedJob.error}</p></div>
                                    ) : (
                                        <div className="w-full max-w-md px-6 text-center">
                                            <Spinner color="primary" size="lg" />
                                            <p className="mt-4 text-sm text-white">{selectedJob === null ? '動画を選択してください' : `${getStatusLabel(selectedJob.status)} ${Math.round(selectedJob.progress * 100)}%`}</p>
                                            {selectedJob !== null && <Progress aria-label="処理の進捗" color="primary" value={selectedJob.progress * 100} className="mt-5" />}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {selectedJob?.analysis !== null && selectedJob?.analysis !== undefined && selectedJob.plan !== null && (
                                <div className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
                                    <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
                                        <div className="flex-1">
                                            <div className="flex items-center justify-between gap-3">
                                                <div><p className="text-sm font-semibold text-white">フレーム量</p><p className="mt-1 text-[11px] text-muted">完成グリッドの空き枠は、情報量の多いカットへ再配分します。</p></div>
                                                <div className="flex rounded-lg border border-line bg-ink p-1">
                                                    <Button size="sm" color={selectedJob.frameMode === 'auto' ? 'primary' : 'default'} variant={selectedJob.frameMode === 'auto' ? 'solid' : 'light'} onPress={() => updateSelectedPlan({ frameMode: 'auto' })}>自動</Button>
                                                    <Button size="sm" color={selectedJob.frameMode === 'fixed' ? 'primary' : 'default'} variant={selectedJob.frameMode === 'fixed' ? 'solid' : 'light'} onPress={() => updateSelectedPlan({ frameMode: 'fixed' })}>枚数指定</Button>
                                                </div>
                                            </div>
                                            {selectedJob.frameMode === 'fixed' && (
                                                <div className="mt-5">
                                                    <Slider aria-label="要約の細かさ" color="primary" minValue={selectedJob.analysis.cutCount} maxValue={getFrameCountLimit(selectedJob.analysis)} step={1} value={selectedJob.targetCount} onChange={(value) => updateSelectedPlan({ targetCount: Array.isArray(value) ? value[0] : value })} />
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex-1">
                                            <div className="mb-2 flex items-center justify-between text-xs"><span className="text-muted">横のタイル数</span><span className="font-mono text-lime">{selectedJob.columns}</span></div>
                                            <Slider aria-label="横のタイル数" color="primary" minValue={1} maxValue={Math.max(1, selectedJob.plan.frames.length)} step={1} value={selectedJob.columns} onChange={(value) => updateSelectedPlan({ columns: Array.isArray(value) ? value[0] : value })} />
                                        </div>
                                    </div>
                                    <div className="mt-5 flex flex-col gap-4 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs"><span><span className="text-muted">代表フレーム </span>{selectedJob.plan.frames.length}枚</span><span><span className="text-muted">配置 </span>{selectedJob.plan.columns}列×{selectedJob.plan.rows}段</span><span><span className="text-muted">カット </span>{selectedJob.analysis.cutCount}</span></div>
                                        <Button color="primary" isDisabled={isSelectedCurrent} isLoading={selectedJob.status === 'rendering'} startContent={<Icon icon="solar:refresh-linear" width="18" />} onPress={() => { processingQueueRef.current = processingQueueRef.current.then(() => renderJob(selectedJob.id)); }}>この設定で再生成</Button>
                                    </div>
                                </div>
                            )}
                        </div>

                        <aside className="rounded-2xl border border-line bg-panel p-4 sm:p-5 lg:sticky lg:top-6 lg:self-start">
                            <div className="flex items-center justify-between"><div><p className="text-[11px] font-semibold tracking-[0.14em] text-muted">VIDEOS</p><p className="mt-1 text-sm text-white">{completedCount}/{jobs.value.length}件完了</p></div><Button isIconOnly size="sm" variant="light" aria-label="動画を追加" onPress={() => fileInputRef.current?.click()}><Icon icon="solar:add-circle-linear" width="22" /></Button></div>
                            <div className="mt-4 space-y-3 lg:max-h-[calc(100vh-14rem)] lg:overflow-y-auto lg:pr-1">
                                {jobs.value.map((job) => (
                                    <div key={job.id} className={`rounded-xl border p-3 transition ${selectedJobID.value === job.id ? 'border-lime/60 bg-lime/[0.05]' : 'border-line bg-ink/35'}`}>
                                        <button type="button" className="w-full text-left" onClick={() => { selectedJobID.value = job.id; }}>
                                            <div className="flex items-start justify-between gap-3"><p className="min-w-0 flex-1 truncate text-xs font-semibold text-white">{job.file.name}</p><span className={`shrink-0 text-[10px] ${job.status === 'error' ? 'text-danger-300' : job.status === 'complete' ? 'text-lime' : 'text-muted'}`}>{getStatusLabel(job.status)}{job.status === 'analyzing' || job.status === 'rendering' ? ` ${Math.round(job.progress * 100)}%` : ''}</span></div>
                                            <p className="mt-1 text-[10px] text-muted">{formatFileSize(job.file.size)}{job.analysis !== null ? `・${job.analysis.cutCount}カット・${formatDuration(job.analysis.duration)}` : ''}</p>
                                            {(job.status === 'queued' || job.status === 'analyzing' || job.status === 'rendering') && <Progress aria-label={`${job.file.name} の進捗`} size="sm" color="primary" value={job.progress * 100} className="mt-3" />}
                                        </button>
                                        <div className="mt-3 flex justify-end gap-1 border-t border-line pt-2">
                                            {job.renderedTile !== null && <Button isIconOnly size="sm" variant="light" aria-label={`${job.file.name} を保存`} onPress={() => downloadJob(job)}><Icon icon="solar:download-minimalistic-linear" width="17" /></Button>}
                                            {job.status === 'error' && <Button isIconOnly size="sm" variant="light" aria-label={`${job.file.name} を再試行`} onPress={() => { processingQueueRef.current = processingQueueRef.current.then(() => processJob(job.id)); }}><Icon icon="solar:restart-linear" width="17" /></Button>}
                                            <Button isIconOnly size="sm" variant="light" className="text-muted" aria-label={`${job.file.name} を一覧から閉じる`} onPress={() => removeJob(job.id)}><Icon icon="solar:close-circle-linear" width="18" /></Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-5 border-t border-line pt-4">
                                <dl className="space-y-2 text-xs"><div className="flex justify-between"><dt className="text-muted">形式</dt><dd>{outputFormat.value.toUpperCase()}</dd></div><div className="flex justify-between"><dt className="text-muted">最大解像度</dt><dd>端末に合わせて最大8K</dd></div><div className="flex justify-between"><dt className="text-muted">カット色</dt><dd className="flex gap-1">{CUT_COLORS.map((color) => <span key={color} className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />)}</dd></div></dl>
                            </div>
                        </aside>
                    </div>
                )}
            </section>

            {jobs.value.length > 0 && (
                <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between border-t border-line bg-panel/95 px-4 py-3 backdrop-blur lg:hidden">
                    <span className="text-xs text-muted">{completedCount}/{jobs.value.length}件完了</span>
                    <div className="flex gap-2"><Button size="sm" variant="bordered" className="border-line" onPress={() => fileInputRef.current?.click()}>動画を追加</Button><Button size="sm" color="primary" isDisabled={completedCount === 0 || hasStaleOutputs || isAnyProcessing} isLoading={isBatchSaving.value} onPress={() => { void downloadAll(); }}>{batchSaveLabel}</Button></div>
                </div>
            )}
        </main>
    );
}
