const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const http = require('http');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(cors());
app.use(express.json());

// 1. تحديد مسار التخزين (يقرأ المجلد من Railway Volume أو يستخدم المجلد المحلي)
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 2. ربط قاعدة البيانات SQLite داخل مجلد الـ Volume
const dbPath = path.join(dataDir, 'vehicles_database.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('خطأ في الاتصال بقاعدة البيانات:', err.message);
  } else {
    console.log('تم الاتصال بقاعدة البيانات بنجاح في المسار:', dbPath);
  }
});

// 3. تجهيز الجداول في قاعدة البيانات
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS vehicles (
    id TEXT PRIMARY KEY,
    model TEXT,
    color TEXT,
    plate_number TEXT,
    owner_name TEXT,
    entry_time TEXT,
    is_inside INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS vehicle_models (name TEXT UNIQUE)`);
  db.run(`CREATE TABLE IF NOT EXISTS vehicle_colors (name TEXT UNIQUE)`);
  db.run(`CREATE TABLE IF NOT EXISTS vehicle_owners (name TEXT UNIQUE)`);
});

// الاتصال عبر Socket.io للمزامنة اللحظية
io.on('connection', (socket) => {
  console.log('جهاز جديد اتصل بالمزامنة اللحظية:', socket.id);
});

// خدمة ملفات الويب الناتجة من فلاتر
app.use(express.static(path.join(__dirname, 'web_build')));

// API: جلب السيارات
app.get('/api/vehicles', (req, res) => {
  db.all(`SELECT * FROM vehicles ORDER BY entry_time DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const formatted = (rows || []).map(r => ({
      id: r.id,
      model: r.model,
      color: r.color,
      plateNumber: r.plate_number,
      ownerName: r.owner_name,
      entryTime: r.entry_time,
      isInside: r.is_inside === 1
    }));
    res.json(formatted);
  });
});

// API: إضافة سيارة جديدة
app.post('/api/vehicles', (req, res) => {
  const { id, model, color, plateNumber, ownerName, entryTime, isInside } = req.body;
  const sql = `INSERT INTO vehicles (id, model, color, plate_number, owner_name, entry_time, is_inside) VALUES (?, ?, ?, ?, ?, ?, ?)`;
  
  db.run(sql, [id, model, color, plateNumber, ownerName, entryTime, isInside ? 1 : 0], function (err) {
    if (err) return res.status(500).json({ error: err.message });

    if (model) db.run(`INSERT OR IGNORE INTO vehicle_models (name) VALUES (?)`, [model]);
    if (color) db.run(`INSERT OR IGNORE INTO vehicle_colors (name) VALUES (?)`, [color]);
    if (ownerName) db.run(`INSERT OR IGNORE INTO vehicle_owners (name) VALUES (?)`, [ownerName]);

    io.emit('vehicles_updated');
    res.status(201).json({ message: 'تم الحفظ والمزامنة بنجاح' });
  });
});

// API: تعديل بيانات سيارة كاملة
app.put('/api/vehicles/:id', (req, res) => {
  const { id } = req.params;
  const { model, color, plateNumber, ownerName } = req.body;
  const sql = `UPDATE vehicles SET model = ?, color = ?, plate_number = ?, owner_name = ? WHERE id = ?`;

  db.run(sql, [model, color, plateNumber, ownerName, id], function (err) {
    if (err) return res.status(500).json({ error: err.message });

    if (model) db.run(`INSERT OR IGNORE INTO vehicle_models (name) VALUES (?)`, [model]);
    if (color) db.run(`INSERT OR IGNORE INTO vehicle_colors (name) VALUES (?)`, [color]);
    if (ownerName) db.run(`INSERT OR IGNORE INTO vehicle_owners (name) VALUES (?)`, [ownerName]);

    io.emit('vehicles_updated');
    res.json({ message: 'تم تحديث البيانات والمزامنة بنجاح' });
  });
});

// API: تحديث حالة السيارة (دخول / خروج)
app.put('/api/vehicles/:id/status', (req, res) => {
  const { id } = req.params;
  const { isInside } = req.body;
  db.run(`UPDATE vehicles SET is_inside = ? WHERE id = ?`, [isInside ? 1 : 0, id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    
    io.emit('vehicles_updated');
    res.json({ message: 'تم التحديث والمزامنة بنجاح' });
  });
});

// API: جلب الموديلات، الألوان، وأسماء الملاك/المكاتب
app.get('/api/options', (req, res) => {
  db.all(`SELECT name FROM vehicle_models`, [], (err, models) => {
    db.all(`SELECT name FROM vehicle_colors`, [], (err, colors) => {
      db.all(`SELECT name FROM vehicle_owners`, [], (err, owners) => {
        res.json({
          models: (models || []).map((m) => m.name),
          colors: (colors || []).map((c) => c.name),
          owners: (owners || []).map((o) => o.name),
        });
      });
    });
  });
});

// Catch-all لربط مسارات الـ Web
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'web_build', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`السيرفر يعمل بنجاح ومستعد للمزامنة على المنفذ ${PORT}`);
});