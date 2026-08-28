import { Button, Progress, Slider, Spinner } from '@heroui/react';
import { Icon } from '@iconify-icon/react';
import { computed, signal } from '@preact/signals-react';
import { useRef } from 'react';

import { chooseTileLayout, renderTileImage, type RenderedTile } from '~/tile-renderer';
import { analyzeVideo } from '~/video-analyzer';

import type { AnalysisResult } from '~/types';


type ProcessState = 'idle' | 'analyzing' | 'rendering' | 'complete' | 'error';

const processState = signal<ProcessState>('idle');
const progress = signal(0);
const selectedFile = signal<File | null>(null);
const analysisResult = signal<AnalysisResult | null>(null);
const renderedTile = signal<RenderedTile | null>(null);
const previewURL = signal<string | null>(null);
const errorMessage = signal('');
const isDragging = signal(false);
const isRegenerating = signal(false);
const layoutColumns = signal(1);
const processLabel = computed(() => {
    if (processState.value === 'analyzing') {
        return 'カットと動きを解析しています';
    }
    if (processState.value === 'rendering') {
        return '元画質からタイル画像を組み立てています';
    }
    return '';
});

/**
 * ファイルサイズを読みやすい単位へ変換する。
 * @param bytes バイト単位のファイルサイズ
 * @returns 小数1桁までのサイズ表記
 */
function formatFileSize(bytes: number): string {
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 秒数を画面用の簡潔な長さ表記へ変換する。
 * @param seconds 動画の長さ (秒)
 * @returns 分と秒の表記
 */
function formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

/** @useSignals */
export default function Index() {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const renderVersionRef = useRef(0);

    const processFile = async (file: File) => {
        if (file.type.startsWith('video/') === false) {
            processState.value = 'error';
            errorMessage.value = '動画ファイルを選択してください。';
            return;
        }

        // 以前の生成物を解放してから新しい解析へ移り、8K 画像を繰り返し生成してもメモリを回収できる状態にする
        if (previewURL.value !== null) {
            URL.revokeObjectURL(previewURL.value);
        }
        selectedFile.value = file;
        renderVersionRef.current += 1;
        analysisResult.value = null;
        renderedTile.value = null;
        previewURL.value = null;
        errorMessage.value = '';
        isRegenerating.value = false;
        progress.value = 0;
        processState.value = 'analyzing';

        try {
            const result = await analyzeVideo(file, (nextProgress) => {
                progress.value = nextProgress;
            });
            analysisResult.value = result;
            const initialLayout = chooseTileLayout(result);
            layoutColumns.value = initialLayout.columns;
            processState.value = 'rendering';
            const tile = await renderTileImage(file, result, initialLayout, (nextProgress) => {
                progress.value = nextProgress;
            });
            renderedTile.value = tile;
            previewURL.value = URL.createObjectURL(tile.blob);
            processState.value = 'complete';
        } catch (error) {
            console.error('Failed to process video.', error);
            errorMessage.value = error instanceof Error ? error.message : '動画を処理できませんでした。';
            processState.value = 'error';
        }
    };

    const downloadImage = () => {
        if (renderedTile.value === null || selectedFile.value === null) {
            return;
        }

        const downloadURL = URL.createObjectURL(renderedTile.value.blob);
        const anchor = document.createElement('a');
        const baseName = selectedFile.value.name.replace(/\.[^.]+$/, '');
        anchor.href = downloadURL;
        anchor.download = `${baseName}-cut-tiles.png`;
        anchor.click();
        URL.revokeObjectURL(downloadURL);
    };

    const closeResult = () => {
        renderVersionRef.current += 1;
        if (previewURL.value !== null) {
            URL.revokeObjectURL(previewURL.value);
        }
        processState.value = 'idle';
        progress.value = 0;
        selectedFile.value = null;
        analysisResult.value = null;
        renderedTile.value = null;
        previewURL.value = null;
        errorMessage.value = '';
        isDragging.value = false;
        isRegenerating.value = false;
        layoutColumns.value = 1;
    };

    const regenerateTile = async () => {
        if (selectedFile.value === null || analysisResult.value === null) {
            return;
        }

        isRegenerating.value = true;
        const renderVersion = renderVersionRef.current + 1;
        renderVersionRef.current = renderVersion;
        errorMessage.value = '';
        try {
            const tile = await renderTileImage(selectedFile.value, analysisResult.value, { columns: layoutColumns.value }, () => undefined);
            if (renderVersionRef.current !== renderVersion) {
                return;
            }
            if (previewURL.value !== null) {
                URL.revokeObjectURL(previewURL.value);
            }
            renderedTile.value = tile;
            previewURL.value = URL.createObjectURL(tile.blob);
        } catch (error) {
            if (renderVersionRef.current !== renderVersion) {
                return;
            }
            console.error('Failed to regenerate tile image.', error);
            errorMessage.value = error instanceof Error ? error.message : 'タイル画像を再生成できませんでした。';
        } finally {
            if (renderVersionRef.current === renderVersion) {
                isRegenerating.value = false;
            }
        }
    };

    const updateColumns = (value: number | number[]) => {
        const columns = Array.isArray(value) ? value[0] : value;
        layoutColumns.value = columns;
    };

    const isProcessing = processState.value === 'analyzing' || processState.value === 'rendering';

    return (
        <main className="min-h-screen px-8 pb-12 pt-7">
            <header className="mx-auto flex max-w-[1500px] items-center justify-between border-b border-line pb-5">
                <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-lime/40 bg-lime/10 text-lime">
                        <Icon icon="solar:clapperboard-edit-linear" width="22" />
                    </div>
                    <div>
                        <h1 className="text-[15px] font-semibold tracking-[0.16em] text-white">MOVIE CUT TILE GENERATOR</h1>
                        <p className="mt-0.5 text-[10px] tracking-[0.18em] text-muted">CLIENT-SIDE SHOT OVERVIEW</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted">
                    <Icon icon="solar:shield-check-linear" width="17" className="text-lime" />
                    動画はブラウザ内だけで処理されます
                </div>
            </header>

            <section className="mx-auto mt-12 max-w-[1500px]">
                <div className="max-w-4xl">
                    <div className="flex items-center gap-3 text-xs font-semibold tracking-[0.15em] text-lime">
                        <span className="h-px w-8 bg-lime" />
                        SHOT BY SHOT
                    </div>
                    <h2 className="mt-5 text-5xl font-semibold leading-[1.1] tracking-[-0.04em] text-white">
                        映像の流れを、<br />一枚で見渡す。
                    </h2>
                    <p className="mt-6 max-w-2xl text-[15px] leading-7 text-muted">
                        カット境界と画面内の動きを自動で読み取り、変化を伝えるフレームだけを抽出します。静かなカットは簡潔に、動きのあるカットは細かく残します。
                    </p>
                </div>

                <div className="mt-10 grid grid-cols-[minmax(0,1fr)_340px] gap-6">
                    <div className="min-w-0">
                        {processState.value === 'complete' && previewURL.value !== null && renderedTile.value !== null ? (
                            <div className="overflow-hidden rounded-2xl border border-line bg-panel shadow-glow">
                                <div className="flex items-center justify-between border-b border-line px-5 py-4">
                                    <div className="flex items-center gap-3">
                                        <span className="h-2 w-2 rounded-full bg-lime shadow-[0_0_12px_#CBF56C]" />
                                        <span className="text-sm font-semibold">生成結果</span>
                                        <span className="text-xs text-muted">
                                            {renderedTile.value.width} × {renderedTile.value.height} px
                                        </span>
                                        {isRegenerating.value && <Spinner size="sm" color="primary" />}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button color="primary" size="sm" startContent={<Icon icon="solar:download-minimalistic-linear" width="18" />} onPress={downloadImage}>
                                            PNG を保存
                                        </Button>
                                        <Button isIconOnly aria-label="生成結果を閉じる" variant="light" size="sm" className="text-muted" onPress={closeResult}>
                                            <Icon icon="solar:close-circle-linear" width="22" />
                                        </Button>
                                    </div>
                                </div>
                                <div className="checkerboard flex min-h-[430px] items-center justify-center overflow-auto p-6">
                                    <div className="relative flex max-h-[640px] max-w-full items-center justify-center">
                                        <img src={previewURL.value} alt="生成されたカットタイル" className={`max-h-[640px] max-w-full object-contain shadow-2xl transition-opacity ${isRegenerating.value ? 'opacity-55' : 'opacity-100'}`} />
                                        {isRegenerating.value && (
                                            <div className="absolute inset-0 flex items-center justify-center">
                                                <div className="flex items-center gap-3 rounded-full border border-line bg-ink/90 px-4 py-2 text-xs text-white shadow-xl">
                                                    <Spinner size="sm" color="primary" />
                                                    タイルを再生成しています
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <button
                                type="button"
                                className={`group flex min-h-[500px] w-full flex-col items-center justify-center rounded-2xl border bg-panel/60 px-12 text-center transition ${isDragging.value ? 'border-lime bg-lime/[0.06]' : 'border-line hover:border-lime/50 hover:bg-panel'}`}
                                onClick={() => fileInputRef.current?.click()}
                                onDragEnter={(event) => { event.preventDefault(); isDragging.value = true; }}
                                onDragOver={(event) => { event.preventDefault(); isDragging.value = true; }}
                                onDragLeave={(event) => {
                                    if (event.currentTarget.contains(event.relatedTarget as Node) === false) {
                                        isDragging.value = false;
                                    }
                                }}
                                onDrop={(event) => {
                                    event.preventDefault();
                                    isDragging.value = false;
                                    const file = event.dataTransfer.files[0];
                                    if (file !== undefined && isProcessing === false) {
                                        void processFile(file);
                                    }
                                }}
                                disabled={isProcessing}
                            >
                                {isProcessing ? (
                                    <>
                                        <Spinner color="primary" size="lg" />
                                        <p className="mt-7 text-lg font-semibold text-white">{processLabel.value}</p>
                                        <p className="mt-2 text-sm text-muted">タブを閉じずにお待ちください</p>
                                        <Progress aria-label="処理の進捗" color="primary" value={progress.value * 100} className="mt-7 max-w-md" />
                                        <p className="mt-3 font-mono text-xs text-lime">{Math.round(progress.value * 100)}%</p>
                                    </>
                                ) : (
                                    <>
                                        <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-line bg-ink text-muted transition group-hover:border-lime/40 group-hover:text-lime">
                                            <Icon icon="solar:upload-square-linear" width="38" />
                                        </div>
                                        <p className="mt-7 text-xl font-semibold text-white">動画をここへドロップ</p>
                                        <p className="mt-2 text-sm text-muted">またはクリックしてファイルを選択</p>
                                        <div className="mt-7 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-muted">
                                            <span className="rounded border border-line px-2 py-1">MP4</span>
                                            <span className="rounded border border-line px-2 py-1">WebM</span>
                                            <span className="rounded border border-line px-2 py-1">MOV</span>
                                        </div>
                                    </>
                                )}
                            </button>
                        )}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="video/*"
                            className="hidden"
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file !== undefined) {
                                    void processFile(file);
                                }
                                event.target.value = '';
                            }}
                        />

                        {processState.value === 'error' && (
                            <div className="mt-4 flex items-start gap-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger-300">
                                <Icon icon="solar:danger-triangle-linear" width="20" className="mt-0.5 shrink-0" />
                                <span>{errorMessage.value}</span>
                            </div>
                        )}
                    </div>

                    <aside className="space-y-5">
                        <div className="rounded-2xl border border-line bg-panel p-5">
                            <div className="flex items-center justify-between">
                                <p className="text-[11px] font-semibold tracking-[0.14em] text-muted">OUTPUT</p>
                                <span className="rounded-full bg-lime/10 px-2 py-1 text-[10px] font-semibold text-lime">
                                    {processState.value === 'complete' ? 'LIVE' : 'AUTO'}
                                </span>
                            </div>
                            <dl className="mt-5 space-y-3 text-xs">
                                <div className="flex justify-between gap-4"><dt className="text-muted">形式</dt><dd>PNG</dd></div>
                                <div className="flex justify-between gap-4"><dt className="text-muted">最大解像度</dt><dd>7680 × 4320</dd></div>
                                <div className="flex justify-between gap-4"><dt className="text-muted">目標比率</dt><dd>16:9</dd></div>
                                <div className="flex justify-between gap-4"><dt className="text-muted">カット色</dt><dd className="flex gap-1">
                                    {['#65E68A', '#FFE176', '#FFAC72', '#FF8FB8', '#CF9CFF', '#86B7FF'].map((color) => (
                                        <span key={color} className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
                                    ))}
                                </dd></div>
                            </dl>
                            {analysisResult.value !== null && processState.value === 'complete' && (
                                <div className="mt-5 space-y-5 border-t border-line pt-5">
                                    <div>
                                        <div className="mb-2 flex items-center justify-between text-xs">
                                            <span className="text-muted">横のタイル数</span>
                                            <span className="font-mono text-lime">{layoutColumns.value}</span>
                                        </div>
                                        <Slider
                                            aria-label="横のタイル数"
                                            color="primary"
                                            minValue={1}
                                            maxValue={analysisResult.value.frames.length}
                                            step={1}
                                            value={layoutColumns.value}
                                            onChange={updateColumns}
                                        />
                                    </div>
                                    <p className="text-[11px] leading-5 text-muted">縦のタイル数はフレーム数から自動で決まります。</p>
                                    <Button
                                        color="primary"
                                        fullWidth
                                        isDisabled={renderedTile.value?.columns === layoutColumns.value}
                                        isLoading={isRegenerating.value}
                                        startContent={isRegenerating.value ? undefined : <Icon icon="solar:refresh-linear" width="18" />}
                                        onPress={() => { void regenerateTile(); }}
                                    >
                                        この列数で再生成
                                    </Button>
                                </div>
                            )}
                        </div>

                        {selectedFile.value !== null && (
                            <div className="rounded-2xl border border-line bg-panel p-5">
                                <p className="truncate text-sm font-semibold text-white">{selectedFile.value.name}</p>
                                <p className="mt-1 text-xs text-muted">{formatFileSize(selectedFile.value.size)}</p>
                                {analysisResult.value !== null && (
                                    <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-4 text-center">
                                        <div><p className="text-lg font-semibold">{analysisResult.value.cutCount}</p><p className="text-[10px] text-muted">CUTS</p></div>
                                        <div><p className="text-lg font-semibold">{analysisResult.value.frames.length}</p><p className="text-[10px] text-muted">FRAMES</p></div>
                                        <div><p className="text-lg font-semibold">{formatDuration(analysisResult.value.duration)}</p><p className="text-[10px] text-muted">LENGTH</p></div>
                                    </div>
                                )}
                                {processState.value === 'complete' && (
                                    <Button variant="bordered" size="sm" fullWidth className="mt-4 border-line" startContent={<Icon icon="solar:restart-linear" width="17" />} onPress={closeResult}>
                                        結果を閉じて別の動画へ
                                    </Button>
                                )}
                            </div>
                        )}
                    </aside>
                </div>
            </section>
        </main>
    );
}
