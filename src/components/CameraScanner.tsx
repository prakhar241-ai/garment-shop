"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorCtor = {
  new (opts: { formats: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

/**
 * Live camera barcode reader. Uses the browser's own BarcodeDetector where it
 * exists (Chrome on Android) and falls back to zxing (iPhone Safari, laptops).
 * Keeps scanning until closed; the same code is ignored for 1.5 s so one
 * item held in front of the camera is not added twice.
 */
export function CameraScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const t = useTranslations("sell");
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let stopZxing: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = { code: "", at: 0 };

    const found = (raw: string) => {
      const code = raw.trim();
      const now = Date.now();
      if (!code || (code === last.code && now - last.at < 1500)) return;
      last = { code, at: now };
      navigator.vibrate?.(60);
      beep();
      onCodeRef.current(code);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();

        const Native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
        const formats = Native ? ((await Native.getSupportedFormats?.()) ?? []) : [];
        if (Native && formats.includes("code_128")) {
          const detector = new Native({ formats: ["code_128"] });
          const loop = async () => {
            if (stopped || !video.current) return;
            try {
              const codes = await detector.detect(video.current);
              if (codes[0]) found(codes[0].rawValue);
            } catch {}
            timer = setTimeout(loop, 120);
          };
          loop();
        } else {
          const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
            import("@zxing/browser"),
            import("@zxing/library"),
          ]);
          const hints = new Map();
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]);
          hints.set(DecodeHintType.TRY_HARDER, true);
          const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
          const controls = await reader.decodeFromVideoElement(video.current, (result) => {
            if (result) found(result.getText());
          });
          stopZxing = () => controls.stop();
          if (stopped) stopZxing();
        }
      } catch {
        if (!stopped) setFailed(true);
      }
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stopZxing?.();
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-2xl bg-black">
        <video ref={video} playsInline muted className="aspect-[4/3] w-full object-cover" />
        {/* Aiming box */}
        <div className="pointer-events-none absolute inset-x-8 top-1/2 h-20 -translate-y-1/2 rounded-lg border-4 border-white/80" />
        <p className="absolute inset-x-0 bottom-2 text-center text-sm font-semibold text-white drop-shadow">
          {failed ? t("cameraError") : t("cameraHint")}
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="min-h-12 rounded-xl border-2 border-border bg-surface text-lg font-semibold"
      >
        {t("stopScan")}
      </button>
    </div>
  );
}

let audio: AudioContext | null = null;
/** Short beep so the shopkeeper knows the scan worked without looking. */
function beep() {
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 1500;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.08);
  } catch {}
}
