const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const prismaDb = require('./prisma_db');
const pakasir = require('./pakasir');
const config = require('./config');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Cache memory to prevent duplicate/redundant active group writes
const syncCache = new Map();

function getPayloadHash(groups) {
    if (!Array.isArray(groups)) return '';
    // Sort by JID to make sure comparison is order-independent
    const sorted = [...groups].sort((a, b) => (a.jid || '').localeCompare(b.jid || ''));
    // Extract only core values that affect the database representation
    const simplified = sorted.map(g => ({
        jid: g.jid,
        name: g.name,
        expiredAt: g.expiredAt,
        memberCount: g.memberCount,
        photo: g.photo
    }));
    return crypto.createHash('md5').update(JSON.stringify(simplified)).digest('hex');
}

// Bot API Cache Configuration
let apiCache = {
    orders: new Map(),
    lastUpdate: new Map() // Simpan lastUpdate per key
};
const CACHE_TTL = 5000; // 5 seconds cache

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'favicon.ico'));
});

app.get('/favicon.png', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'favicon.png'));
});

app.get('/', async (req, res) => {
    const pricingData = config.PRICING || { store: {}, guild: {}, cc: {} };
    const infoGroups = config.INFO_GROUP_LINK || {};
    const contacts = config.CONTACT_OWNER || [];

    if (req.query.checkout) {
        try {
            const order = await prismaDb.getOrder(req.query.checkout);
            if (order) {
                return res.render('index', { 
                    pricing: pricingData, 
                    contacts: contacts,
                    infoGroups: infoGroups,
                    orderId: order.id, 
                    qris: order.payment_number,
                    harga: order.harga,
                    status: order.status,
                    jenis_bot: order.jenis_bot
                });
            }
        } catch(e) {
            console.error('Render error:', e);
        }
    }
    res.render('index', { 
        pricing: pricingData, 
        contacts: contacts,
        infoGroups: infoGroups,
        orderId: null, 
        qris: null, 
        harga: 0, 
        status: 'PENDING',
        jenis_bot: 'store'
    });
});

app.post('/checkout', async (req, res) => {
    try {
        const { email, link_group, jenis_bot, tipe_order, paket } = req.body;
        const pricingData = config.PRICING || { store: {}, guild: {}, cc: {} };
        const infoGroups = config.INFO_GROUP_LINK || {};
        
        if (!email || !link_group || !jenis_bot || !tipe_order || !paket || !pricingData[jenis_bot] || !pricingData[jenis_bot][paket]) {
            return res.status(400).json({ success: false, message: 'Data tidak valid. Pastikan semua field terisi.' });
        }

        const harga = pricingData[jenis_bot][paket].harga;
        const hari = pricingData[jenis_bot][paket].hari;
        const orderId = 'ORD-' + Date.now();
        const groupInfoLink = infoGroups[jenis_bot] || '#';

        let trx;
        let finalStatus = 'PENDING';

        if (global.debug) {
            const expiredWIB = new Date(Date.now() + (200 * 5000)).toLocaleTimeString('id-ID', {
                hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta', hour12: false
            }).replace('.', ':');
            
            trx = {
                payment_number: 'DEBUG-QRIS',
                expired_at: expiredWIB
            };
        } else {
            trx = await pakasir.createTransaction(orderId, harga);
        }

        const orderData = {
            id: orderId,
            email: email,
            link_group: link_group,
            info_group: groupInfoLink,
            jenis_bot: jenis_bot,
            tipe_order: tipe_order,
            paket: paket,
            durasi_hari: hari,
            harga: harga,
            payment_number: trx.payment_number,
            expired_at: trx.expired_at,
            status: finalStatus,
            created_at: new Date().toISOString()
        };
        await prismaDb.addOrder(orderData);

        res.json({
            success: true,
            orderId: orderId,
            qris: trx.payment_number,
            harga: harga,
            expired: trx.expired_at,
            status: finalStatus,
            jenis_bot: jenis_bot
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/cancel/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const order = await prismaDb.getOrder(id);
        
        if (order && order.status === 'PENDING') {
            await pakasir.cancelTransaction(order.id, order.harga);
            await prismaDb.updateOrderStatus(id, 'CANCELLED');
            res.json({ success: true, message: 'Transaksi berhasil dibatalkan.' });
        } else {
            res.status(400).json({ success: false, message: 'Transaksi tidak ditemukan atau sudah tidak pending.' });
        }
    } catch(e) {
        res.status(500).json({ success: false, message: 'Gagal membatalkan transaksi.' });
    }
});

app.get('/status/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const order = await prismaDb.getOrder(id);

        if (!order) {
            return res.status(404).json({ error: 'Order tidak ditemukan' });
        }

        if (order.status === 'PENDING') {
            // Simulasi Sukses Otomatis untuk Mode Debug
            if (global.debug && order.payment_number === 'DEBUG-QRIS') {
                const startTime = new Date(order.created_at).getTime();
                if (Date.now() - startTime > 20000) { // 20 detik
                    console.log(`[DEBUG] Simulasi pembayaran sukses untuk: ${id}`);
                    await prismaDb.updateOrderStatus(id, 'PAID');
                    return res.json({ status: 'PAID' });
                }
                return res.json({ status: 'PENDING' });
            }

            // Cek status asli ke Pakasir
            const detail = await pakasir.getTransactionDetail(id, order.harga);
            if (detail && detail.status === 'completed') {
                await prismaDb.updateOrderStatus(id, 'PAID');
                return res.json({ status: 'PAID' });
            }
        }

        res.json({ status: order.status });
    } catch (e) {
        console.error('Status check error:', e);
        res.status(500).json({ error: 'Gagal mengecek status' });
    }
});


// API Endpoints for Bots
app.get('/api/orders', async (req, res) => {
    try {
        const { jenis_bot } = req.query;
        const cacheKey = jenis_bot || 'all';
        const now = Date.now();

        // Check if valid cache exists for THIS key
        const lastUpd = apiCache.lastUpdate.get(cacheKey) || 0;
        if (apiCache.orders.has(cacheKey) && (now - lastUpd < CACHE_TTL)) {
            return res.json(apiCache.orders.get(cacheKey));
        }

        // Handle multiple bot types (e.g. jenis_bot=v3,guild)
        let filters = null;
        if (jenis_bot) {
            filters = jenis_bot.split(',').map(s => s.trim());
        }
        
        const orders = await prismaDb.getPendingOrders(filters);
        
        // Update cache
        apiCache.orders.set(cacheKey, orders);
        apiCache.lastUpdate.set(cacheKey, now);

        res.json(orders);
    } catch (e) {
        console.error('API Orders Error:', e);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/orders/update', async (req, res) => {
    try {
        const { id, status } = req.body;
        if (!id || !status) {
            return res.status(400).json({ error: 'Missing id or status' });
        }
        await prismaDb.updateOrderStatus(id, status);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/groups/update', async (req, res) => {
    try {
        const { orderId, name, photo, jid } = req.body;
        if (!orderId) {
            return res.status(400).json({ error: 'Missing orderId' });
        }
        await prismaDb.updateGroupInfo({ orderId, name, photo, jid });
        res.json({ success: true });
    } catch (e) {
        console.error('API Group Update Error:', e);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/groups/sync', async (req, res) => {
    try {
        const { groups, jenis_bot } = req.body;
        if (!groups || !jenis_bot) {
            return res.status(400).json({ error: 'Missing groups or jenis_bot' });
        }

        // Hitung hash payload untuk mendeteksi perubahan data grup
        const payloadHash = getPayloadHash(groups);
        const cacheKey = `sync_${jenis_bot}`;

        if (syncCache.get(cacheKey) === payloadHash) {
            // Jika data sama persis, langsung return sukses tanpa sentuh DB
            return res.json({ success: true, cached: true });
        }

        await prismaDb.syncActiveGroups(groups, jenis_bot);
        
        // Simpan hash terbaru ke memory cache
        syncCache.set(cacheKey, payloadHash);
        
        res.json({ success: true });
    } catch (e) {
        console.error('API Group Sync Error:', e);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Admin Routes
app.get('/user/admin', (req, res) => {
    if (req.cookies.admin_token === config.ADMIN_PASSWORD) {
        return res.redirect('/user/admin/dashboard');
    }
    res.render('admin_login', { error: null });
});

app.post('/user/admin', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === config.ADMIN_PASSWORD) {
        res.cookie('admin_token', config.ADMIN_PASSWORD, { maxAge: 24 * 60 * 60 * 1000, httpOnly: true });
        return res.redirect('/user/admin/dashboard');
    }
    res.render('admin_login', { error: 'Username atau Password salah!' });
});

app.get('/user/admin/dashboard', async (req, res) => {
    if (req.cookies.admin_token !== config.ADMIN_PASSWORD) {
        return res.redirect('/user/admin');
    }
    // Trigger update pembayaran pending secara non-blocking saat admin membuka dashboard
    pollPendingPayments().catch(err => console.error('[POLLER] Dashboard poll error:', err));

    try {
        const orders = await prismaDb.getAllOrders();
        const activeGroups = await prismaDb.getActiveGroups();
        const telegramBotToken = await prismaDb.getSetting('telegram_bot_token') || '';
        const telegramOwnerId = await prismaDb.getSetting('telegram_owner_id') || '';
        
        res.render('admin_dashboard', { 
            orders, 
            activeGroups, 
            telegramBotToken, 
            telegramOwnerId 
        });
    } catch (e) {
        console.error('Error rendering dashboard:', e);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/user/admin/settings', async (req, res) => {
    if (req.cookies.admin_token !== config.ADMIN_PASSWORD) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    try {
        const { telegramBotToken, telegramOwnerId } = req.body;
        await prismaDb.setSetting('telegram_bot_token', telegramBotToken || '');
        await prismaDb.setSetting('telegram_owner_id', telegramOwnerId || '');
        res.json({ success: true });
    } catch (e) {
        console.error('Error saving settings:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/user/admin/logout', (req, res) => {
    res.clearCookie('admin_token');
    res.redirect('/user/admin');
});

app.listen(PORT, () => {
    console.log(`🚀 Ravenweb berjalan di http://localhost:${PORT}`);
});

// =============================================
// BACKGROUND POLLER: Cek pembayaran PENDING ke Pakasir setiap 12 detik
// Tidak bergantung pada browser user tetap terbuka
// =============================================
async function pollPendingPayments() {
    try {
        const pendingOrders = await prismaDb.getPendingOrders(null);
        const onlyPending = pendingOrders.filter(o => o.status === 'PENDING' && o.payment_number !== 'DEBUG-QRIS');

        if (onlyPending.length === 0) return;

        console.log(`[POLLER] Mengecek ${onlyPending.length} order PENDING ke Pakasir...`);

        for (const order of onlyPending) {
            try {
                const detail = await pakasir.getTransactionDetail(order.id, order.harga);
                if (detail && detail.status === 'completed') {
                    await prismaDb.updateOrderStatus(order.id, 'PAID');
                    // Invalidate cache agar bot langsung ambil data terbaru
                    apiCache.orders.clear();
                    apiCache.lastUpdate.clear();
                    console.log(`[POLLER] ✅ Order ${order.id} berhasil diupdate ke PAID.`);
                }
            } catch (e) {
                // Abaikan error per-order, lanjut order berikutnya
            }
        }
    } catch (e) {
        console.error('[POLLER] Error saat polling Pakasir:', e.message);
    }
}

// Deteksi lingkungan serverless/Vercel secara sangat tangguh
const isServerless = !!(
    process.env.VERCEL ||
    process.env.LAMBDA_TASK_ROOT ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.NOW_REGION
);

// Jalankan poller setiap 12 detik hanya jika bukan di lingkungan Vercel serverless
if (!isServerless) {
    setInterval(pollPendingPayments, 12000);
    pollPendingPayments().catch(err => console.error('[POLLER] Initial poll error:', err));
}

app.listen(PORT, () => {
    console.log(`[SERVER] Running on http://localhost:${PORT}`);
});

module.exports = app;
