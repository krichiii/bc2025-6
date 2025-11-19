#!/usr/bin/env node

/**
 * Inventory service (Lab #6)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { program } = require('commander');
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

// ------------------------------------------------------------------
// Commander CLI
// ------------------------------------------------------------------

program
  .requiredOption('-h, --host <host>', 'server host')
  .requiredOption('-p, --port <port>', 'server port', parseInt)
  .requiredOption('-c, --cache <cacheDir>', 'cache directory');

program.parse();
const options = program.opts();

const HOST = options.host;
const PORT = options.port;
const CACHE_DIR = path.resolve(options.cache);

// Create cache directory if needed
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

const PHOTOS_DIR = path.join(CACHE_DIR, 'photos');
if (!fs.existsSync(PHOTOS_DIR)) {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
}

const DB_FILE = path.join(CACHE_DIR, 'inventory.json');

// Init DB
let db = {};
if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8') || '{}');
  } catch (err) {
    console.error('Error reading DB. Starting empty DB...');
    db = { items: [] };
  }
} else {
  db = { items: [] };
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function findItem(id) {
  return db.items.find(i => i.id === id);
}

// ------------------------------------------------------------------
// Express setup
// ------------------------------------------------------------------

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Multer storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PHOTOS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const fname = uuidv4() + ext;
    cb(null, fname);
  }
});
const upload = multer({ storage });

// Forms (static)
app.get('/RegisterForm.html', (req, res) =>
  res.sendFile(path.join(process.cwd(), 'RegisterForm.html'))
);

app.get('/SearchForm.html', (req, res) =>
  res.sendFile(path.join(process.cwd(), 'SearchForm.html'))
);

// Helper: restrict methods
function allowMethods(methods) {
  return (req, res, next) => {
    if (!methods.includes(req.method)) {
      res.set('Allow', methods.join(', '));
      return res.status(405).send('Method Not Allowed');
    }
    next();
  };
}

// ------------------------------------------------------------------
// API
// ------------------------------------------------------------------

app.post('/register', allowMethods(['POST']), upload.single('photo'), (req, res) => {
  const name = req.body.inventory_name;
  const desc = req.body.description || '';

  if (!name) {
    return res.status(400).json({ error: 'inventory_name is required' });
  }

  const id = uuidv4();
  const file = req.file ? req.file.filename : null;

  const item = {
    id,
    name,
    description: desc,
    photo: file ? `/inventory/${id}/photo` : null,
    storedFileName: file
  };

  db.items.push(item);
  saveDb();

  const { storedFileName, ...publicData } = item;
  res.status(201).json(publicData);
});

app.get('/inventory', allowMethods(['GET']), (req, res) => {
  const items = db.items.map(({ storedFileName, ...publicInfo }) => publicInfo);
  res.status(200).json(items);
});

app.get('/inventory/:id', allowMethods(['GET']), (req, res) => {
  const item = findItem(req.params.id);
  if (!item) return res.status(404).send('Not found');

  const { storedFileName, ...publicData } = item;
  res.status(200).json(publicData);
});

app.put('/inventory/:id', allowMethods(['PUT']), (req, res) => {
  const item = findItem(req.params.id);
  if (!item) return res.status(404).send('Not found');

  if (req.body.name) item.name = req.body.name;
  if (req.body.description) item.description = req.body.description;

  saveDb();

  const { storedFileName, ...publicData } = item;
  res.status(200).json(publicData);
});

app.get('/inventory/:id/photo', allowMethods(['GET']), (req, res) => {
  const item = findItem(req.params.id);
  if (!item || !item.storedFileName) return res.status(404).send('Not found');

  const file = path.join(PHOTOS_DIR, item.storedFileName);
  if (!fs.existsSync(file)) return res.status(404).send('Not found');

  res.set('Content-Type', 'image/jpeg');
  fs.createReadStream(file).pipe(res);
});

app.put('/inventory/:id/photo', allowMethods(['PUT']), upload.single('photo'), (req, res) => {
  const item = findItem(req.params.id);
  if (!item) return res.status(404).send('Not found');

  if (!req.file) return res.status(400).send('No file uploaded');

  // Delete old file
  if (item.storedFileName) {
    const p = path.join(PHOTOS_DIR, item.storedFileName);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  item.storedFileName = req.file.filename;
  item.photo = `/inventory/${item.id}/photo`;

  saveDb();

  const { storedFileName, ...publicData } = item;
  res.status(200).json(publicData);
});

app.delete('/inventory/:id', allowMethods(['DELETE']), (req, res) => {
  const idx = db.items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).send('Not found');

  const item = db.items[idx];

  // Remove photo
  if (item.storedFileName) {
    const file = path.join(PHOTOS_DIR, item.storedFileName);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  db.items.splice(idx, 1);
  saveDb();

  res.status(200).json({ message: 'Deleted' });
});

// Search POST (form-urlencoded)
app.post('/search', allowMethods(['POST']), (req, res) => {
  const id = req.body.id;
  const hp = req.body.has_photo;

  if (!id) return res.status(400).send('id required');

  const item = findItem(id);
  if (!item) return res.status(404).send('Not found');

  let description = item.description;
  if (hp && item.photo) {
    description += ` Photo: ${item.photo}`;
  }

  res.status(200).json({
    id: item.id,
    name: item.name,
    description
  });
});

// Search GET (для SearchForm.html)
app.get('/search', allowMethods(['GET']), (req, res) => {
  const id = req.query.id;
  const hp = req.query.includePhoto;

  if (!id) return res.status(400).send('id required');

  const item = findItem(id);
  if (!item) return res.status(404).send('Not found');

  let description = item.description;
  if (hp && item.photo) {
    description += ` Photo: ${item.photo}`;
  }

  res.status(200).json({
    id: item.id,
    name: item.name,
    description
  });
});

// Fallback for unknown routes
app.use((req, res) => res.status(404).send('Not found'));

// ------------------------------------------------------------------
// Start server
// ------------------------------------------------------------------

const server = http.createServer(app);
server.listen(PORT, HOST, () => {
  console.log(`Running on http://${HOST}:${PORT}`);
  console.log(`Cache directory: ${CACHE_DIR}`);
});