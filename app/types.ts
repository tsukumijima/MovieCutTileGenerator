export type AnalysisSample = {
    time: number;
    change: number;
    motion: number;
};

export type SelectedFrame = {
    cutIndex: number;
    time: number;
};

export type AnalysisResult = {
    cutCount: number;
    duration: number;
    frames: SelectedFrame[];
    sourceHeight: number;
    sourceWidth: number;
};
