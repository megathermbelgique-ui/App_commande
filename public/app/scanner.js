// Lecture de codes-barres avec la caméra.
// Utilise le lecteur natif du navigateur quand il existe, sinon la bibliothèque
// ZXing (cas de l'iPhone / iPad).

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];

let zxingPromise;
function loadZxing() {
  zxingPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/zxing.min.js';
    s.onload = () => resolve(window.ZXing);
    s.onerror = () => reject(new Error('Lecteur de codes-barres indisponible.'));
    document.head.append(s);
  });
  return zxingPromise;
}

async function makeDecoder() {
  if ('BarcodeDetector' in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = FORMATS.filter((f) => supported.includes(f));
      if (formats.includes('ean_13')) {
        const detector = new window.BarcodeDetector({ formats });
        return async (video) => (await detector.detect(video))[0]?.rawValue || null;
      }
    } catch {}
  }
  const Z = await loadZxing();
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [
    Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E,
    Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.ITF, Z.BarcodeFormat.QR_CODE,
  ]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  const reader = new Z.MultiFormatReader();
  reader.setHints(hints);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw) return null;
    const scale = Math.min(1, 1000 / vw);
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
      return reader.decodeWithState(bitmap).getText();
    } catch {
      return null; // rien de lisible dans cette image
    }
  };
}

// Démarre la caméra arrière dans <video> et appelle onCode(code) à chaque lecture.
// Renvoie { stop, pause, resume }.
export async function startScanner(video, onCode) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("La caméra n'est pas accessible. L'application doit être ouverte en HTTPS.");
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (e) {
    throw new Error(
      e.name === 'NotAllowedError'
        ? "Accès à la caméra refusé. Autorisez la caméra dans les réglages de l'appareil."
        : 'Impossible de démarrer la caméra.'
    );
  }
  video.srcObject = stream;
  await video.play().catch(() => {});

  let stopped = false;
  let paused = false;
  let last = { code: '', at: 0 };
  let decode;
  try {
    decode = await makeDecoder();
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }

  (async function loop() {
    while (!stopped) {
      if (!paused && video.readyState >= 2) {
        const code = await decode(video).catch(() => null);
        const now = Date.now();
        // Ignore la relecture immédiate du même code (l'article est encore devant l'objectif).
        if (code && !paused && !stopped && !(code === last.code && now - last.at < 2500)) {
          last = { code, at: now };
          onCode(code);
        } else if (code && code === last.code) last.at = now;
      }
      await new Promise((r) => setTimeout(r, 120));
    }
  })();

  return {
    pause: () => (paused = true),
    resume: () => {
      paused = false;
      last.at = Date.now();
    },
    stop: () => {
      stopped = true;
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}
