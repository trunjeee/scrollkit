const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const unpack = (p) => p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
const FFMPEG = unpack(require('ffmpeg-static'));
const FFPROBE = unpack(require('ffprobe-static').path);

let sharp = null;
function getSharp() {
  if (!sharp) sharp = require('sharp');
  return sharp;
}

function run(bin, args, { onLine, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', (d) => {
      const s = d.toString();
      if (onLine) s.split(/\r?\n/).forEach((l) => l && onLine(l));
      else out += s;
    });
    child.stderr.on('data', (d) => { err += d.toString(); if (err.length > 20000) err = err.slice(-10000); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (signal && signal.aborted) return reject(Object.assign(new Error('cancelled'), { cancelled: true }));
      code === 0 ? resolve(out) : reject(new Error(`${path.basename(bin)} exited ${code}\n${err.slice(-1500)}`));
    });
    if (signal) signal.addEventListener('abort', () => child.kill('SIGKILL'), { once: true });
  });
}

async function probe(file) {
  const out = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]);
  const j = JSON.parse(out);
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  if (!v) throw new Error('No video stream');
  let w = v.width, h = v.height;
  const rot = ((v.side_data_list || []).find((d) => d.rotation != null) || {}).rotation || (v.tags && parseInt(v.tags.rotate)) || 0;
  if (Math.abs(rot) % 180 === 90) [w, h] = [h, w];
  const [a, b] = (v.avg_frame_rate || v.r_frame_rate || '0/1').split('/').map(Number);
  const fps = b ? a / b : 0;
  const duration = parseFloat(v.duration || (j.format && j.format.duration) || 0);
  return {
    width: w, height: h, fps: Math.round(fps * 100) / 100, duration,
    codec: v.codec_name, frames: parseInt(v.nb_frames) || Math.round(duration * fps),
    size: j.format && parseInt(j.format.size) || 0
  };
}

function cropFilter(crop) {
  if (!crop || !crop.aspect || crop.aspect === 'none') return null;
  const [aw, ah] = crop.aspect.split(':').map(Number);
  const A = aw / ah;
  const x = Number(crop.x ?? 0.5), y = Number(crop.y ?? 0.5);
  return `crop=w='min(iw\\,ih*${A})':h='min(ih\\,iw/${A})':x='(iw-ow)*${x}':y='(ih-oh)*${y}'`;
}

async function emptyDir(dir) {
  await fs.promises.rm(dir, { recursive: true, force: true });
  await fs.promises.mkdir(dir, { recursive: true });
}

/**
 * opts: { input, outDir, start, end, srcDuration, mode, count, fps, width, format, quality, crop, onProgress, signal, maxCount }
 */
async function extractFrames(o) {
  const dur = Math.max(0.05, (o.end > 0 ? Math.min(o.end, o.srcDuration || o.end) : o.srcDuration) - (o.start || 0));
  let fps = o.mode === 'fps' ? o.fps : o.count / dur;
  let expected = Math.round(fps * dur);
  const cap = o.maxCount || 2000;
  if (expected > cap) { fps = cap / dur; expected = cap; }
  const fmt = o.format;
  await emptyDir(o.outDir);
  const tmpPng = fmt === 'avif' ? path.join(o.outDir, '.tmp') : null;
  if (tmpPng) await fs.promises.mkdir(tmpPng, { recursive: true });
  const target = tmpPng || o.outDir;

  const vf = o.single ? [] : [`fps=${fps.toFixed(5)}`];
  const cf = cropFilter(o.crop);
  if (cf) vf.push(cf);
  vf.push(`scale=w='min(${Math.round(o.width)}\\,iw)':h=-2:flags=lanczos`);

  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'];
  if (o.start > 0) args.push('-ss', String(o.start));
  if (o.single) args.push('-i', o.input, '-frames:v', '1'); else args.push('-t', dur.toFixed(3), '-i', o.input);
  args.push('-an', '-sn', '-vf', vf.join(','));
  const q = Math.max(1, Math.min(100, o.quality));
  let ext = fmt;
  if (fmt === 'webp') args.push('-c:v', 'libwebp', '-quality', String(q), '-compression_level', '5', '-preset', 'photo');
  else if (fmt === 'jpg') args.push('-c:v', 'mjpeg', '-q:v', String(Math.max(2, Math.min(31, Math.round(2 + (100 - q) * 0.29)))), '-pix_fmt', 'yuvj420p');
  else { args.push('-c:v', 'png', '-compression_level', '1'); ext = 'png'; }
  args.push('-progress', 'pipe:1', '-nostats', path.join(target, `%04d.${ext}`));

  await run(FFMPEG, args, {
    signal: o.signal,
    onLine: (l) => {
      const m = /^frame=(\d+)/.exec(l);
      if (m && o.onProgress) o.onProgress(Math.min(1, Number(m[1]) / Math.max(1, expected)) * (fmt === 'avif' ? 0.5 : 1));
    }
  });

  if (fmt === 'avif') {
    const sh = getSharp();
    const files = (await fs.promises.readdir(tmpPng)).filter((f) => f.endsWith('.png')).sort();
    let done = 0, idx = 0;
    const worker = async () => {
      while (idx < files.length) {
        if (o.signal && o.signal.aborted) throw Object.assign(new Error('cancelled'), { cancelled: true });
        const f = files[idx++];
        await sh(path.join(tmpPng, f)).avif({ quality: q, effort: 3 }).toFile(path.join(o.outDir, f.replace('.png', '.avif')));
        done++;
        if (o.onProgress) o.onProgress(0.5 + 0.5 * done / files.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, os.cpus().length) }, worker));
    await fs.promises.rm(tmpPng, { recursive: true, force: true });
  }

  const files = (await fs.promises.readdir(o.outDir)).filter((f) => f.endsWith('.' + fmt)).sort();
  if (!files.length) throw new Error('ffmpeg produced no frames');
  let bytes = 0;
  for (const f of files) bytes += (await fs.promises.stat(path.join(o.outDir, f))).size;
  let width = 0, height = 0;
  try {
    const m = await getSharp()(path.join(o.outDir, files[0])).metadata();
    width = m.width; height = m.height;
  } catch (e) {
    const p = await probe(path.join(o.outDir, files[0])).catch(() => null);
    if (p) { width = p.width; height = p.height; }
  }
  return { count: files.length, width, height, bytes, ext: fmt, fps };
}

let estSeq = 0;
// average encoded frame size from 3 sample frames (fast size estimate)
async function sampleSize(o) {
  const dur = Math.max(0.05, (o.end > 0 ? o.end : o.srcDuration) - (o.start || 0));
  const dir = path.join(os.tmpdir(), 'scrollkit-est-' + process.pid + '-' + (++estSeq));
  await emptyDir(dir);
  const sizes = [];
  let dims = null;
  for (const k of [0.2, 0.5, 0.8]) {
    const sub = path.join(dir, String(k));
    const r = await extractFrames({ ...o, outDir: sub, start: (o.start || 0) + dur * k, end: 0, srcDuration: (o.start || 0) + dur * k + 0.1, mode: 'fps', fps: 1, single: true, onProgress: null, maxCount: 1 })
      .catch((e) => { console.error('sample', e.message); return null; });
    if (r) { sizes.push(r.bytes / r.count); dims = dims || r; }
  }
  await fs.promises.rm(dir, { recursive: true, force: true });
  if (!sizes.length) return null;
  return { avg: sizes.reduce((a, b) => a + b, 0) / sizes.length, width: dims.width, height: dims.height };
}

module.exports = { probe, extractFrames, sampleSize, FFMPEG, FFPROBE };
