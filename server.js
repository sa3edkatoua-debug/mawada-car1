const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(cors());
app.use(express.json());

// 1. الاتصال بقاعدة بيانات Supabase عبر متغير البيئة DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 2. إنشاء الجداول تلقائياً إن لم تكن موجودة عند تشغيل السيرفر
const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vehicles (
        id VARCHAR(255) PRIMARY KEY,
        model TEXT,
        color TEXT,
        plate_number TEXT,
        owner_name TEXT,
        entry_time TEXT,
        is_inside BOOLEAN DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS vehicle_models (name TEXT UNIQUE);
      CREATE TABLE IF NOT EXISTS vehicle_colors (name TEXT UNIQUE);
      CREATE TABLE IF NOT EXISTS vehicle_owners (name TEXT UNIQUE);
    `);
    console.log('تم الاتصال بـ Supabase وإنشاء الجداول بنجاح');
  } catch (err) {
    console.error('خطأ في تهيئة قاعدة بيانات Supabase:', err.message);
  }
};
initDB();

// الاتصال عبر Socket.io للمزامنة اللحظية
io.on('connection', (socket) => {
  console.log('جهاز جديد اتصل بالمزامنة اللحظية:', socket.id);
});

// صفحة رئيسية بسيطة للتحقق من عمل السيرفر
app.get('/', (req, res) => {
  res.send('Vehicle Backend Server is running successfully!');
});

// API: جلب السيارات
app.get('/api/vehicles', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, model, color, plate_number AS "plateNumber", owner_name AS "ownerName", entry_time AS "entryTime", is_inside AS "isInside" FROM vehicles ORDER BY entry_time DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: إضافة سيارة جديدة
app.post('/api/vehicles', async (req, res) => {
  try {
    const { id, model, color, plateNumber, ownerName, entryTime, isInside } = req.body;
    
    await pool.query(
      'INSERT INTO vehicles (id, model, color, plate_number, owner_name, entry_time, is_inside) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, model, color, plateNumber, ownerName, entryTime, isInside ?? true]
    );

    if (model) await pool.query('INSERT INTO vehicle_models (name) VALUES ($1) ON CONFLICT DO NOTHING', [model]);
    if (color) await pool.query('INSERT INTO vehicle_colors (name) VALUES ($1) ON CONFLICT DO NOTHING', [color]);
    if (ownerName) await pool.query('INSERT INTO vehicle_owners (name) VALUES ($1) ON CONFLICT DO NOTHING', [ownerName]);

    io.emit('vehicles_updated');
    res.status(201).json({ message: 'تم الحفظ والمزامنة بنجاح' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: تعديل بيانات سيارة كاملة
app.put('/api/vehicles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { model, color, plateNumber, ownerName } = req.body;

    await pool.query(
      'UPDATE vehicles SET model = $1, color = $2, plate_number = $3, owner_name = $4 WHERE id = $5',
      [model, color, plateNumber, ownerName, id]
    );

    if (model) await pool.query('INSERT INTO vehicle_models (name) VALUES ($1) ON CONFLICT DO NOTHING', [model]);
    if (color) await pool.query('INSERT INTO vehicle_colors (name) VALUES ($1) ON CONFLICT DO NOTHING', [color]);
    if (ownerName) await pool.query('INSERT INTO vehicle_owners (name) VALUES ($1) ON CONFLICT DO NOTHING', [ownerName]);

    io.emit('vehicles_updated');
    res.json({ message: 'تم تحديث البيانات والمزامنة بنجاح' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: تحديث حالة السيارة (دخول / خروج)
app.put('/api/vehicles/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { isInside } = req.body;

    await pool.query('UPDATE vehicles SET is_inside = $1 WHERE id = $2', [isInside, id]);

    io.emit('vehicles_updated');
    res.json({ message: 'تم التحديث والمزامنة بنجاح' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: تصفير جدول السيارات فقط مع الحفاظ على القوائم الأساسية
app.delete('/api/vehicles/reset', async (req, res) => {
  try {
    await pool.query('DELETE FROM vehicles');
    io.emit('vehicles_updated');
    res.json({ message: 'تم تصفير سجلات السيارات بنجاح مع الحفاظ على القوائم' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: جلب الموديلات، الألوان، وأسماء الملاك/المكاتب
app.get('/api/options', async (req, res) => {
  try {
    const models = await pool.query('SELECT name FROM vehicle_models');
    const colors = await pool.query('SELECT name FROM vehicle_colors');
    const owners = await pool.query('SELECT name FROM vehicle_owners');

    res.json({
      models: models.rows.map(m => m.name),
      colors: colors.rows.map(c => c.name),
      owners: owners.rows.map(o => o.name),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`السيرفر يعمل بنجاح ومستعد للمزامنة على المنفذ ${PORT}`);
});