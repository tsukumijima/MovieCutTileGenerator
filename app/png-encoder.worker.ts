import UPNG from 'upng-js';


type EncodeRequest = {
    height: number;
    pixels: ArrayBuffer;
    width: number;
};

self.addEventListener('message', (event: MessageEvent<EncodeRequest>) => {
    const { height, pixels, width } = event.data;
    const encoded = UPNG.encode([pixels], width, height, 0);
    self.postMessage(encoded, { transfer: [encoded] });
});
