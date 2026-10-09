// Durée d'un fichier mp4 (secondes) lue dans son en-tête « mvhd », sans le décoder. null si illisible.
const fsp = require('fs/promises');

async function readAt(fh, pos, len) {
  const buf = Buffer.alloc(len);
  const r = await fh.read(buf, 0, len, pos);
  return buf.subarray(0, r.bytesRead);
}

async function mp4Duration(file, size) {
  const fh = await fsp.open(file, 'r');
  try {
    let pos = 0;
    while (pos + 8 <= size) {
      const h = await readAt(fh, pos, 16);
      if (h.length < 8) return null;
      let len = h.readUInt32BE(0);
      const type = h.toString('latin1', 4, 8);
      let head = 8;
      if (len === 1 && h.length >= 16) {
        len = Number(h.readBigUInt64BE(8));
        head = 16;
      } else if (len === 0) {
        len = size - pos;
      }
      if (len < head) return null;
      if (type === 'moov') {
        const body = await readAt(fh, pos + head, Math.min(len - head, 4096));
        const i = body.indexOf('mvhd', 0, 'latin1');
        if (i < 0 || i + 32 > body.length) return null;
        // après « mvhd » : version(1) flags(3) puis v0 : création(4) modif.(4) échelle(4) durée(4) ; v1 : 8+8+4+8
        if (body[i + 4] === 1) return Number(body.readBigUInt64BE(i + 28)) / body.readUInt32BE(i + 24);
        return body.readUInt32BE(i + 20) / body.readUInt32BE(i + 16);
      }
      pos += len;
    }
    return null;
  } finally {
    await fh.close();
  }
}

/** Durée en secondes, ou null si le format n'est pas pris en charge ou illisible. */
async function readDuration(file, size) {
  try {
    const d = await mp4Duration(file, size);
    return Number.isFinite(d) && d > 0 ? Math.round(d * 10) / 10 : null;
  } catch {
    return null;
  }
}

module.exports = { readDuration };
