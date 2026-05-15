import { memo, useEffect, useRef } from 'react';

import styles from './QrCode.module.css';

type Props = {
  value: string;
  size: number;
  theme?: 'light' | 'dark';
};

/** Black mark on transparent SVG — on white circular island (light theme: black-on-white matrix). */
const LOGO_LIGHT_BASE64 =
  'PHN2ZyB3aWR0aD0iNDMiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCA0MyA0OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTIuNDIxMzggMTAuMTkyM0MtMC43MzQyNTUgMTMuODcxNyAtMC44MTc0NjcgMTguOTkzNCAyLjI0MjE1IDIxLjYyMTVDNS4zMDE3NyAyNC4yNTYgMTAuMzM5MyAyMy40MDM1IDEzLjUwMTMgMTkuNzE3N0MxNi42NTY5IDE2LjAzODMgMTYuNzQwMSAxMC45MTY3IDEzLjY4MDUgOC4yODg1NEMxMi40ODM2IDcuMjU2NTIgMTAuOTczIDYuNzYyOTQgOS4zOTgzNCA2Ljc2Mjk0QzYuOTUzMiA2Ljc2Mjk0IDQuMzQxNjQgNy45NTUyMSAyLjQyMTM4IDEwLjE5MjNaIiBmaWxsPSJibGFjayIvPgo8cGF0aCBkPSJNMS41MDYxNCAyOS4yMzA0Qy0wLjg2ODU4NCAzMi4wNTA4IDAuMTYxOTU2IDM2LjgzOTIgMy44MTA0NiAzOS45MjI0QzcuNDU4OTYgNDMuMDA1NyAxMi4zNDkyIDQzLjIyMzYgMTQuNzI0IDQwLjQwMzJDMTcuMDk4NyAzNy41ODI3IDE2LjA2ODEgMzIuNzk0NCAxMi40MTk2IDI5LjcxMTJDMTAuNDg2NiAyOC4wNzY2IDguMjA3ODYgMjcuMjQ5NyA2LjE0MDM4IDI3LjI0OTdDNC4zMDMzMyAyNy4yNDk3IDIuNjI2MyAyNy45MDM1IDEuNTEyNTQgMjkuMjMwNCIgZmlsbD0iYmxhY2siLz4KPHBhdGggZD0iTTIyLjkyOTcgMzkuNTUwNkMxOC42NDc1IDQwLjkwMzIgMTUuNjk2NyA0My42NTk1IDE2LjMzNjggNDUuNzA0M0MxNi45ODMzIDQ3Ljc0OTEgMjAuOTc3NCA0OC4zMTMyIDI1LjI1OTYgNDYuOTU0M0MyOS41NDE4IDQ1LjYwMTcgMzIuNDkyNiA0Mi44NDU0IDMxLjg1MjUgNDAuODAwNkMzMS40NDI4IDM5LjUxMjIgMjkuNzAxOCAzOC44MDcxIDI3LjM5NzUgMzguODA3MUMyNi4wNDY5IDM4LjgwNzEgMjQuNTEwNyAzOS4wNDQyIDIyLjkyOTcgMzkuNTQ0MiIgZmlsbD0iYmxhY2siLz4KPHBhdGggZD0iTTE2LjIyOCAyLjYyODE5QzE1LjM0NDcgNS4xNzk0IDE4LjE0ODMgOC40NzQxOCAyMi41MDA5IDkuOTkzMzdDMjYuODUzNSAxMS41MTI2IDMxLjA5NzMgMTAuNjcyOCAzMS45ODA2IDguMTIxNjNDMzIuODYzOSA1LjU3MDQyIDMwLjA2MDMgMi4yNzU2NCAyNS43MDc3IDAuNzU2NDUyQzI0LjI0MTkgMC4yNDM2NDYgMjIuNzgyNSA2LjIyMDk2ZS0wNSAyMS40NjQgNi4xOTc5MWUtMDVDMTguODcxNiA2LjE1MjU4ZS0wNSAxNi44MTA1IDAuOTM1OTMzIDE2LjIyOCAyLjYyODE5WiIgZmlsbD0iYmxhY2siLz4KPHBhdGggZD0iTTM1Ljc5NiA3Ljc2OTc5QzM0LjUzNTEgOC4yNzYxOCAzNC44MzU5IDExLjk2MiAzNi40NjE3IDE1Ljk4NzVDMzguMDg3NSAyMC4wMTk0IDQwLjQyMzkgMjIuODcxOSA0MS42ODQ4IDIyLjM2NTVDNDIuOTM5NCAyMS44NTkxIDQyLjY0NSAxOC4xNzk4IDQxLjAxOTEgMTQuMTQ3OEMzOS41MjEzIDEwLjQzIDM3LjQxNTQgNy43MTIxIDM2LjEwOTcgNy43MTIxQzM2LjAwMDkgNy43MTIxIDM1Ljg5ODQgNy43MzEzMyAzNS43OTYgNy43Njk3OVoiIGZpbGw9ImJsYWNrIi8+CjxwYXRoIGQ9Ik0zNi43NjE5IDMyLjI2MjZDMzQuOTY5NyAzNi4xNTM1IDM0LjM0ODggMzkuNjk4MyAzNS4zNzkzIDQwLjE3MjZDMzYuNDA5OSA0MC42NDcgMzguNzAxNCAzNy44Nzc4IDQwLjQ5MzYgMzMuOTg2OUM0Mi4yOTIzIDMwLjA5NiA0Mi45MDY4IDI2LjU1MTIgNDEuODgyNiAyNi4wNzY5QzQxLjgwNTggMjYuMDM4NCA0MS43MjI2IDI2LjAyNTYgNDEuNjI2NiAyNi4wMjU2QzQwLjUwNjQgMjYuMDI1NiAzOC40MTk4IDI4LjY2NjUgMzYuNzYxOSAzMi4yNjI2WiIgZmlsbD0iYmxhY2siLz4KPC9zdmc+Cg==';

/** White mark on transparent SVG — on dark circular island (dark theme: white-on-dark matrix). */
const LOGO_DARK_BASE64 =
  'PHN2ZyB3aWR0aD0iNTgiIGhlaWdodD0iNjUiIHZpZXdCb3g9IjAgMCA1OCA2NSIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMy4yNjM5NyAxMy43MjY1Qy0wLjk4OTc3MiAxOC42ODE3IC0xLjEwMTk0IDI1LjU3OTIgMy4wMjIzNyAyOS4xMTg3QzcuMTQ2NjkgMzIuNjY2NyAxMy45MzcxIDMxLjUxODYgMTguMTk5NSAyNi41NTQ3QzIyLjQ1MzIgMjEuNTk5NSAyMi41NjU0IDE0LjcwMiAxOC40NDExIDExLjE2MjZDMTYuODI3NiA5Ljc3MjcxIDE0Ljc5MTMgOS4xMDc5OSAxMi42Njg4IDkuMTA3OTlDOS4zNzI3NyA5LjEwNzk5IDUuODUyNDUgMTAuNzEzNyAzLjI2Mzk3IDEzLjcyNjVaIiBmaWxsPSJ3aGl0ZSIvPjxwYXRoIGQ9Ik0yLjAzMDAxIDM5LjM2NTdDLTEuMTcxMDggNDMuMTY0MSAwLjIxODA2NiA0OS42MTI4IDUuMTM2MTggNTMuNzY1MUMxMC4wNTQzIDU3LjkxNzQgMTYuNjQ2MyA1OC4yMTEgMTkuODQ3NCA1NC40MTI2QzIzLjA0ODUgNTAuNjE0MiAyMS42NTkzIDQ0LjE2NTUgMTYuNzQxMiA0MC4wMTMyQzE0LjEzNTUgMzcuODExOCAxMS4wNjM4IDM2LjY5ODIgOC4yNzY4NyAzNi42OTgyQzUuODAwNTUgMzYuNjk4MiAzLjUzOTk2IDM3LjU3ODcgMi4wMzg2NCAzOS4zNjU3IiBmaWxsPSJ3aGl0ZSIvPjxwYXRoIGQ9Ik0zMC45MDg3IDUzLjI2NDNDMjUuMTM2NCA1NS4wODU5IDIxLjE1ODggNTguNzk3OSAyMi4wMjE2IDYxLjU1MThDMjIuODkzMSA2NC4zMDU2IDI4LjI3NzEgNjUuMDY1MyAzNC4wNDk0IDYzLjIzNTFDMzkuODIxNyA2MS40MTM2IDQzLjc5OTQgNTcuNzAxNiA0Mi45MzY2IDU0Ljk0NzdDNDIuMzg0MyA1My4yMTI2IDQwLjAzNzUgNTIuMjYzIDM2LjkzMTMgNTIuMjYzQzM1LjExMDcgNTIuMjYzIDMzLjAzOTkgNTIuNTgyNCAzMC45MDg3IDUzLjI1NTciIGZpbGw9IndoaXRlIi8+PHBhdGggZD0iTTIxLjg3NDkgMy41Mzk0MkMyMC42ODQyIDYuOTc1MjQgMjQuNDYzNCAxMS40MTI1IDMwLjMzMDYgMTMuNDU4NEMzNi4xOTc5IDE1LjUwNDQgNDEuOTE4NCAxNC4zNzM1IDQzLjEwOTEgMTAuOTM3N0M0NC4yOTk4IDcuNTAxODQgNDAuNTIwNiAzLjA2NDYyIDM0LjY1MzQgMS4wMTg2NkMzMi42Nzc1IDAuMzI4MDQ0IDMwLjcxMDMgMCAyOC45MzI5IDBDMjUuNDM4NCAwIDIyLjY2MDEgMS4yNjAzOCAyMS44NzQ5IDMuNTM5NDJaIiBmaWxsPSJ3aGl0ZSIvPjxwYXRoIGQ9Ik00OC4yNTE2IDEwLjQ2MzhDNDYuNTUxOSAxMS4xNDU4IDQ2Ljk1NzQgMTYuMTA5NiA0OS4xNDkgMjEuNTMwOUM1MS4zNDA2IDI2Ljk2MDkgNTQuNDg5OSAzMC44MDI1IDU2LjE4OTcgMzAuMTIwNUM1Ny44ODA4IDI5LjQzODUgNTcuNDgzOSAyNC40ODMzIDU1LjI5MjMgMTkuMDUzNEM1My4yNzMzIDE0LjA0NjQgNTAuNDM0NiAxMC4zODYxIDQ4LjY3NDQgMTAuMzg2MUM0OC41Mjc3IDEwLjM4NjEgNDguMzg5NyAxMC40MTIgNDguMjUxNiAxMC40NjM4WiIgZmlsbD0id2hpdGUiLz48cGF0aCBkPSJNNDkuNTU0NCA0My40NDkxQzQ3LjEzODUgNDguNjg5MiA0Ni4zMDE1IDUzLjQ2MzEgNDcuNjkwNyA1NC4xMDE5QzQ5LjA3OTggNTQuNzQwNyA1Mi4xNjg4IDUxLjAxMTQgNTQuNTg0NyA0NS43NzEzQzU3LjAwOTIgNDAuNTMxMyA1Ny44Mzc2IDM1Ljc1NzQgNTYuNDU3IDM1LjExODVDNTYuMzUzNSAzNS4wNjY3IDU2LjI0MTMgMzUuMDQ5NSA1Ni4xMTE5IDM1LjA0OTVDNTQuNjAyIDM1LjA0OTUgNTEuNzg5MSAzOC42MDYyIDQ5LjU1NDQgNDMuNDQ5MVoiIGZpbGw9IndoaXRlIi8+PC9zdmc+';

type BitMatrix = { size: number; data: Uint8Array };

const QUIET_ZONE = 4;
const FINDER_SIZE = 7;

function renderQrToCanvas(canvas: HTMLCanvasElement, modules: BitMatrix, pxSize: number, matrixColor: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const totalModules = modules.size + QUIET_ZONE * 2;
  // Snap cell size to an integer device-pixel grid so data modules stay crisp.
  const cellSizeDevice = Math.max(1, Math.floor((pxSize * dpr) / totalModules));
  const canvasSizeDevice = cellSizeDevice * totalModules;

  canvas.width = canvasSizeDevice;
  canvas.height = canvasSizeDevice;
  canvas.style.width = `${pxSize}px`;
  canvas.style.height = `${pxSize}px`;

  ctx.clearRect(0, 0, canvasSizeDevice, canvasSizeDevice);

  const moduleCount = modules.size;
  const isInFinder = (row: number, col: number) =>
    (row < FINDER_SIZE && col < FINDER_SIZE) ||
    (row < FINDER_SIZE && col >= moduleCount - FINDER_SIZE) ||
    (row >= moduleCount - FINDER_SIZE && col < FINDER_SIZE);

  ctx.fillStyle = matrixColor;
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (!modules.data[row * moduleCount + col]) {
        continue;
      }
      if (isInFinder(row, col)) {
        continue;
      }
      const x = (col + QUIET_ZONE) * cellSizeDevice;
      const y = (row + QUIET_ZONE) * cellSizeDevice;
      ctx.fillRect(x, y, cellSizeDevice, cellSizeDevice);
    }
  }

  const drawFinderCircle = (row: number, col: number) => {
    const cx = (col + FINDER_SIZE / 2 + QUIET_ZONE) * cellSizeDevice;
    const cy = (row + FINDER_SIZE / 2 + QUIET_ZONE) * cellSizeDevice;

    ctx.fillStyle = matrixColor;
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5 * cellSizeDevice, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5 * cellSizeDevice, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = matrixColor;
    ctx.beginPath();
    ctx.arc(cx, cy, 1.5 * cellSizeDevice, 0, Math.PI * 2);
    ctx.fill();
  };

  drawFinderCircle(0, 0);
  drawFinderCircle(0, moduleCount - FINDER_SIZE);
  drawFinderCircle(moduleCount - FINDER_SIZE, 0);
}

export const QrCode = memo(({ value, size, theme = 'light' }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDark = theme === 'dark';
  const logoBase64 = isDark ? LOGO_DARK_BASE64 : LOGO_LIGHT_BASE64;
  const logoDataUrl = `data:image/svg+xml;base64,${logoBase64}`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !value) {
      return;
    }

    let cancelled = false;
    const capturedValue = value;
    const matrixColor = getComputedStyle(canvas).color;

    void import('qrcode')
      .then(QRCode => {
        if (cancelled) {
          return;
        }
        const qr = QRCode.default.create(capturedValue, { errorCorrectionLevel: 'H' });
        renderQrToCanvas(canvas, qr.modules, size, matrixColor);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.error('[host-papp-react-ui] QR render failed:', err);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [value, size, isDark]);

  if (!value) {
    return <div className={styles.container} style={{ height: size, width: size }} aria-hidden />;
  }

  return (
    <div className={styles.container} style={{ height: size, width: size }}>
      <div className={styles.qrFrame} style={{ width: size, height: size }}>
        <canvas ref={canvasRef} className={isDark ? styles.qrCanvasDark : styles.qrCanvasLight} aria-hidden />
        <div className={isDark ? styles.logoBackdropDark : styles.logoBackdropLight} aria-hidden>
          <img className={styles.logo} src={logoDataUrl} alt="" width={1} height={1} />
        </div>
      </div>
    </div>
  );
});
