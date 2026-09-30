const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(cors());
app.use(express.json());

// الاتصال بقواعد البيانات وتجهيز الجداول
const dbPath = path.join(__dirname, 'vehicles_database.db');
const db = new sqlite3.Database(dbPath);

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
});

// الاتصال عبر Socket
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

    db.run(`INSERT OR IGNORE INTO vehicle_models (name) VALUES (?)`, [model]);
    db.run(`INSERT OR IGNORE INTO vehicle_colors (name) VALUES (?)`, [color]);

    // إرسال إشارة تحديث فورية لجميع الأجهزة
    io.emit('vehicles_updated');

    res.status(201).json({ message: 'تم الحفظ والمزامنة بنجاح' });
  });
});

// API: تحديث حالة السيارة
app.put('/api/vehicles/:id/status', (req, res) => {
  const { id } = req.params;
  const { isInside } = req.body;
  db.run(`UPDATE vehicles SET is_inside = ? WHERE id = ?`, [isInside ? 1 : 0, id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    
    // إرسال إشارة تحديث فورية لجميع الأجهزة
    io.emit('vehicles_updated');

    res.json({ message: 'تم التحديث والمزامنة بنجاح' });
  });
});

// API: جلب الموديلات والألوان
app.get('/api/options', (req, res) => {
  db.all(`SELECT name FROM vehicle_models`, [], (err, models) => {
    db.all(`SELECT name FROM vehicle_colors`, [], (err, colors) => {
      res.json({
        models: (models || []).map((m) => m.name),
        colors: (colors || []).map((c) => c.name),
      });
    });
  });
});

// Catch-all لربط مسارات الـ Web
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'web_build', 'index.html'));
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`السيرفر يعمل بنجاح ومستعد للمزامنة على المنفذ ${PORT}`);
});