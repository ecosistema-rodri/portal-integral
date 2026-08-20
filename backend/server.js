import express from 'express';
import cors from 'cors';
import multer from 'multer';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 10000;
const {
  ADMIN_KEY,
  GITHUB_TOKEN,
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_BRANCH = 'main',
  ALLOWED_ORIGIN,
  DATA_PATH = 'data/places.json',
  UPLOAD_DIR = 'assets/uploads'
} = process.env;

const required = { ADMIN_KEY, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, ALLOWED_ORIGIN };
for (const [key, value] of Object.entries(required)) {
  if (!value) console.warn(`[config] Falta ${key}`);
}

app.disable('x-powered-by');
app.use(cors({
  origin(origin, callback) {
    if (!origin || origin === ALLOWED_ORIGIN || origin.startsWith(`${ALLOWED_ORIGIN}/`)) return callback(null, true);
    return callback(new Error('Origen no permitido por CORS'));
  },
  methods: ['POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Admin-Key']
}));
app.use(express.json({ limit: '1mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 12, fileSize: 8 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype);
    cb(ok ? null : new Error('Formato de imagen no admitido'), ok);
  }
});

function requireAdmin(req, res, next) {
  const supplied = req.get('x-admin-key') || '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(ADMIN_KEY || '');
  if (!ADMIN_KEY || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ ok: false, error: 'Clave de edición incorrecta.' });
  }
  next();
}

function ghUrl(path) {
  return `https://api.github.com/repos/${encodeURIComponent(GITHUB_OWNER)}/${encodeURIComponent(GITHUB_REPO)}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;
}

async function githubFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2026-03-10',
      'User-Agent': 'flash-work-mapa-editor',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
  if (!response.ok) {
    const error = new Error(body?.message || `GitHub respondió ${response.status}`);
    error.status = response.status;
    error.details = body;
    throw error;
  }
  return body;
}

async function getRepoFile(path) {
  return githubFetch(ghUrl(path));
}

async function putRepoFile(path, buffer, message) {
  let sha;
  try {
    const current = await getRepoFile(path);
    sha = current.sha;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  const body = {
    message,
    content: buffer.toString('base64'),
    branch: GITHUB_BRANCH
  };
  if (sha) body.sha = sha;

  const url = ghUrl(path).replace(/\?ref=.*$/, '');
  return githubFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function deleteRepoFile(path, message) {
  const current = await getRepoFile(path);
  const url = ghUrl(path).replace(/\?ref=.*$/, '');
  return githubFetch(url, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha: current.sha, branch: GITHUB_BRANCH })
  });
}

async function readDatabase() {
  const file = await getRepoFile(DATA_PATH);
  const json = Buffer.from((file.content || '').replace(/\n/g, ''), 'base64').toString('utf8');
  const data = JSON.parse(json);
  if (!Array.isArray(data.places)) throw new Error('data/places.json no contiene un arreglo places válido.');
  return data;
}

function safeId(text) {
  return String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 55) || 'lugar';
}

function safeExt(file) {
  const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  return map[file.mimetype] || 'jpg';
}

function normalizePlace(input) {
  const lat = Number(input.coordenadas?.[0]);
  const lng = Number(input.coordenadas?.[1]);
  if (!input.titulo?.trim()) throw new Error('Falta el título.');
  if (!input.localidad?.trim()) throw new Error('Falta la localidad.');
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new Error('Coordenadas inválidas.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fecha || '')) throw new Error('Fecha inválida.');
  return {
    id: String(input.id || ''),
    locked: Boolean(input.locked),
    titulo: input.titulo.trim().slice(0, 140),
    localidad: input.localidad.trim().slice(0, 140),
    coordenadas: [lat, lng],
    fecha: input.fecha,
    resumen: String(input.resumen || '').trim().slice(0, 4000),
    notas: Array.isArray(input.notas) ? input.notas.map(x => String(x).trim()).filter(Boolean).slice(0, 30) : [],
    fotos: Array.isArray(input.fotos) ? input.fotos.map(String).filter(Boolean).slice(0, 40) : []
  };
}

app.post('/api/auth', requireAdmin, (req, res) => {
  res.json({ ok: true, message: 'Modo edición habilitado.' });
});

app.post('/api/places', requireAdmin, upload.array('photos', 12), async (req, res) => {
  try {
    const payload = JSON.parse(req.body.place || '{}');
    const data = await readDatabase();
    let place = normalizePlace(payload);
    const editing = Boolean(place.id);
    const existingIndex = editing ? data.places.findIndex(p => p.id === place.id) : -1;

    if (editing && existingIndex < 0) return res.status(404).json({ ok: false, error: 'El punto a editar ya no existe.' });
    if (existingIndex >= 0 && data.places[existingIndex].locked) place.locked = true;

    if (!editing) {
      const base = `${safeId(place.titulo)}-${place.fecha}`;
      let id = base, n = 2;
      while (data.places.some(p => p.id === id)) id = `${base}-${n++}`;
      place.id = id;
    }

    const existingPhotos = existingIndex >= 0 ? (data.places[existingIndex].fotos || []) : [];
    const retained = new Set(place.fotos || []);
    const removedPhotos = existingPhotos.filter(path => !retained.has(path) && path.startsWith(`${UPLOAD_DIR}/`));

    // GitHub advierte que las escrituras concurrentes de Contents API pueden chocar:
    // por eso las fotos se suben de forma estrictamente secuencial.
    for (const [index, file] of (req.files || []).entries()) {
      const filename = `${Date.now()}-${place.id}-${index + 1}.${safeExt(file)}`;
      const path = `${UPLOAD_DIR}/${filename}`;
      await putRepoFile(path, file.buffer, `Mapa: subir foto de ${place.titulo}`);
      place.fotos.push(path);
    }

    if (existingIndex >= 0) data.places[existingIndex] = place;
    else data.places.push(place);
    data.updatedAt = new Date().toISOString();

    await putRepoFile(DATA_PATH, Buffer.from(JSON.stringify(data, null, 2) + '\n', 'utf8'), `Mapa: ${editing ? 'actualizar' : 'agregar'} ${place.titulo}`);

    // Se borran al final: si alguno falla, los datos ya siguen siendo consistentes.
    for (const path of removedPhotos) {
      try { await deleteRepoFile(path, `Mapa: eliminar foto antigua de ${place.titulo}`); }
      catch (error) { console.warn('[delete photo]', path, error.message); }
    }

    res.json({ ok: true, place, updatedAt: data.updatedAt });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'No se pudo guardar.' });
  }
});

app.delete('/api/places/:id', requireAdmin, async (req, res) => {
  try {
    const data = await readDatabase();
    const index = data.places.findIndex(p => p.id === req.params.id);
    if (index < 0) return res.status(404).json({ ok: false, error: 'El punto no existe.' });
    const place = data.places[index];
    if (place.locked) return res.status(409).json({ ok: false, error: 'Este punto está protegido y no puede eliminarse.' });

    data.places.splice(index, 1);
    data.updatedAt = new Date().toISOString();
    await putRepoFile(DATA_PATH, Buffer.from(JSON.stringify(data, null, 2) + '\n', 'utf8'), `Mapa: eliminar ${place.titulo}`);

    for (const path of (place.fotos || []).filter(p => p.startsWith(`${UPLOAD_DIR}/`))) {
      try { await deleteRepoFile(path, `Mapa: eliminar foto de ${place.titulo}`); }
      catch (error) { console.warn('[delete photo]', path, error.message); }
    }
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'No se pudo eliminar.' });
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(400).json({ ok: false, error: error.message || 'Solicitud inválida.' });
});

app.listen(PORT, '0.0.0.0', () => console.log(`Editor escuchando en ${PORT}`));
