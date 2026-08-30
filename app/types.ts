export type AnalysisSample = {
    time: number;
    change: number;
    motion: number;
};

export type SelectedFrame = {
    cutIndex: number;
    time: number;
};

export type AnalyzedCut = {
    averageMotion: number;
    duration: number;
    endIndex: number;
    isStatic: boolean;
    startIndex: number;
};

export type AnalysisResult = {
    cuts: AnalyzedCut[];
    cutCount: number;
    duration: number;
    samples: AnalysisSample[];
    sourceHeight: number;
    sourceWidth: number;
};

export type FramePlan = {
    columns: number;
    frames: SelectedFrame[];
    rows: number;
};

export type FramePlanOptions = {
    columns?: number;
    mode: 'auto' | 'fixed';
    targetCount?: number;
};

export type OutputFormat = 'jpeg' | 'png';
