// Détection de la langue parlée d'une vidéo : quelques extraits audio (ffmpeg) passés à Whisper (whisper.cpp),
// qui est installé à la demande dans le dossier de données de l'application. Tout se passe sur le PC.
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const WHISPER_URL = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip';
const MODEL_URL = (name) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${name}.bin`;
const SAMPLE_SECONDS = 20;
const CONFIDENT = 0.85; // un seul extrait suffit au-dessus de ce score
const MIN_CONFIDENCE = 0.65; // en dessous : « non détectée » (pas de parole, musique…)

function run(cmd, args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let out = '';
    let err = '';
    p.stdout.on('data', (c) => (out += c));
    p.stderr.on('data', (c) => (err += c));
    const t = setTimeout(() => p.kill(), timeoutMs);
    p.on('error', (e) => resolve({ code: -1, out, err: err + e.message }));
    p.on('close', (code) => {
      clearTimeout(t);
      resolve({ code, out, err });
    });
  });
}

/** dir : dossier d'installation (bin/Release/whisper-cli.exe + ggml-<modèle>.bin) ; ffmpeg : chemin de ffmpeg.exe. */
function createLang({ dir, ffmpeg, modelName = 'tiny' }) {
  const cli = () => path.join(dir, 'bin', 'Release', 'whisper-cli.exe');
  const model = () => path.join(dir, `ggml-${modelName}.bin`);
  const installed = () => fs.existsSync(cli()) && fs.existsSync(model());

  async function download(url, dest, label, onProgress) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`téléchargement refusé (${res.status}) : ${url}`);
    const total = Number(res.headers.get('content-length')) || 0;
    const tmp = dest + '.part';
    const out = fs.createWriteStream(tmp);
    let done = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      done += value.length;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      onProgress({ phase: label, done, total });
    }
    await new Promise((r) => out.end(r));
    fs.renameSync(tmp, dest);
  }

  /** Télécharge Whisper et le modèle choisi (tiny ≈ 80 Mo, base ≈ 150 Mo en plus du moteur). */
  async function install(onProgress = () => {}) {
    await fsp.mkdir(dir, { recursive: true });
    if (!fs.existsSync(cli())) {
      const zip = path.join(dir, 'whisper.zip');
      await download(WHISPER_URL, zip, 'Moteur Whisper', onProgress);
      const r = await run('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath '${zip}' -DestinationPath '${path.join(dir, 'bin')}'`]);
      await fsp.rm(zip, { force: true });
      if (r.code !== 0 || !fs.existsSync(cli())) throw new Error('décompression du moteur impossible : ' + r.err.slice(0, 200));
    }
    if (!fs.existsSync(model())) await download(MODEL_URL(modelName), model(), 'Modèle de langue', onProgress);
  }

  async function sample(file, start, wav) {
    await run(ffmpeg, ['-y', '-loglevel', 'error', '-ss', String(Math.max(0, start)), '-t', String(SAMPLE_SECONDS), '-i', file, '-vn', '-ar', '16000', '-ac', '1', wav], 60000);
    return fs.existsSync(wav) && fs.statSync(wav).size > 32000; // > 1 s d'audio
  }

  async function detectOne(wav) {
    const r = await run(cli(), ['-m', model(), '-f', wav, '--detect-language', '-t', '4']);
    const m = /auto-detected language: (\w+) \(p = ([\d.]+)\)/.exec(r.err + r.out);
    return m ? { lang: m[1], p: Number(m[2]) } : null;
  }

  /**
   * Langue parlée : { lang: 'fr' | 'en' | … | 'und', p } — 'und' si aucune parole n'est reconnue avec assez de confiance.
   * Un extrait suffit s'il est sûr ; sinon deux autres extraits sont ajoutés et la langue se décide au vote.
   */
  async function detectLanguage(file, duration) {
    const dur = duration > 0 ? duration : 60;
    const clamp = (t) => Math.max(0, Math.min(t, Math.max(0, dur - SAMPLE_SECONDS)));
    const points = [clamp(dur * 0.35), clamp(dur * 0.7), clamp(dur * 0.1)];
    const tmp = path.join(os.tmpdir(), `playou4-lang-${process.pid}-${Math.random().toString(36).slice(2)}`);
    const results = [];
    try {
      for (let i = 0; i < points.length; i++) {
        const wav = `${tmp}-${i}.wav`;
        try {
          if (!(await sample(file, points[i], wav))) {
            if (i === 0) return { lang: 'und', p: 0 }; // pas de piste audio
            continue;
          }
          const d = await detectOne(wav);
          if (d) results.push(d);
        } finally {
          await fsp.rm(wav, { force: true });
        }
        if (results.length === 1 && results[0].p >= CONFIDENT) break; // premier extrait sans ambiguïté
      }
    } catch {
      return null; // erreur technique : on réessaiera plus tard
    }
    if (!results.length) return null;
    const score = new Map();
    for (const r of results) score.set(r.lang, (score.get(r.lang) || 0) + r.p);
    const [lang, total] = [...score].sort((a, b) => b[1] - a[1])[0];
    const p = total / results.length;
    return p >= MIN_CONFIDENCE ? { lang, p: Math.round(p * 1000) / 1000 } : { lang: 'und', p: Math.round(p * 1000) / 1000 };
  }

  return { installed, install, detectLanguage };
}

module.exports = createLang;
