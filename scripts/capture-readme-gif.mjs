/**
 * Records in-game footage and writes docs/assets/gameplay.gif for the README.
 * Requires: npm install, npx playwright install chromium, ffmpeg on PATH.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRAMES_DIR = path.join(ROOT, 'docs', 'assets', 'frames');
const GIF_PATH = path.join(ROOT, 'docs', 'assets', 'gameplay.gif');
const DEFAULT_PORT = 0;
const VIEWPORT = { width: 960, height: 540 };
const FRAME_COUNT = 52;
const FRAME_INTERVAL_MS = 110;
const NAV_TIMEOUT_MS = 120000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.json': 'application/json',
};

function startStaticServer(port = DEFAULT_PORT) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const urlPath = (req.url?.split('?')[0] || '/').replace(/\/$/, '') || '/';
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
      const filePath = path.join(ROOT, rel);
      if (!filePath.startsWith(ROOT) || !existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(readFileSync(filePath));
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function serverPort(server) {
  const addr = server.address();
  return typeof addr === 'object' && addr ? addr.port : DEFAULT_PORT;
}

async function flyDemo(page) {
  await page.keyboard.press('Space');
  await page.waitForTimeout(800);
  await page.mouse.move(640, 270);
  await page.keyboard.down('Shift');
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(2200);
  await page.mouse.move(360, 300);
  await page.keyboard.up('KeyD');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1600);
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyQ');
  await page.waitForTimeout(900);
  await page.keyboard.up('KeyQ');
  await page.keyboard.up('Shift');
  await page.mouse.move(480, 255);
  await page.waitForTimeout(400);
}

async function captureFrames(page) {
  mkdirSync(FRAMES_DIR, { recursive: true });
  for (let i = 0; i < FRAME_COUNT; i += 1) {
    const framePath = path.join(FRAMES_DIR, `frame-${String(i).padStart(3, '0')}.png`);
    await page.screenshot({ path: framePath, type: 'png' });
    await page.waitForTimeout(FRAME_INTERVAL_MS);
  }
}

function buildGif() {
  const pattern = path.join(FRAMES_DIR, 'frame-%03d.png');
  const result = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-framerate',
      String(Math.round(1000 / FRAME_INTERVAL_MS)),
      '-i',
      pattern,
      '-vf',
      'fps=10,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3',
      '-loop',
      '0',
      GIF_PATH,
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    throw new Error('ffmpeg failed — install ffmpeg and retry');
  }
}

async function main() {
  const ffmpegCheck = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (ffmpegCheck.error || ffmpegCheck.status !== 0) {
    console.error('ffmpeg is required on PATH');
    process.exit(1);
  }

  mkdirSync(path.dirname(GIF_PATH), { recursive: true });
  if (existsSync(FRAMES_DIR)) {
    rmSync(FRAMES_DIR, { recursive: true });
  }

  const server = await startStaticServer();
  const port = serverPort(server);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT });

  try {
    await page.goto(`http://127.0.0.1:${port}/`, {
      waitUntil: 'load',
      timeout: NAV_TIMEOUT_MS,
    });
    await page.waitForSelector('.start-prompt', { state: 'visible', timeout: 60000 });
    await flyDemo(page);
    await captureFrames(page);
    buildGif();
    console.log(`Wrote ${GIF_PATH}`);
  } finally {
    await browser.close();
    server.close();
    if (existsSync(FRAMES_DIR)) {
      rmSync(FRAMES_DIR, { recursive: true });
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
