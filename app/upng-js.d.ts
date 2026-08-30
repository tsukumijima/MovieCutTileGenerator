declare module 'upng-js' {
    type UPNG = {
        encode(buffers: Array<ArrayBuffer>, width: number, height: number, colorCount: number): ArrayBuffer;
    };

    const UPNG: UPNG;
    export default UPNG;
}
