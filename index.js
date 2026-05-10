const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const prismaDb = require('./prisma_db');
const pakasir = require('./pakasir');
const config = require('./config');

const app = express();
const PORT = process.env.PORT || 3000;

// Bot API Cache Configuration
let apiCache = {
    orders: new Map(),
    lastUpdate: 0
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

        // Check if valid cache exists
        if (apiCache.orders.has(cacheKey) && (now - apiCache.lastUpdate < CACHE_TTL)) {
            if (global.debug) console.log(`[CACHE HIT] Returning cached orders for ${cacheKey}`);
            return res.json(apiCache.orders.get(cacheKey));
        }

        let filters = null;
        if (jenis_bot) {
            filters = jenis_bot.split(',');
        }
        
        const orders = await prismaDb.getPendingOrders(filters);
        
        // Update cache
        apiCache.orders.set(cacheKey, orders);
        apiCache.lastUpdate = now;

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
        await prismaDb.syncActiveGroups(groups, jenis_bot);
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
    const orders = await prismaDb.getAllOrders();
    const activeGroups = await prismaDb.getActiveGroups();
    res.render('admin_dashboard', { orders, activeGroups });
});

app.get('/user/admin/logout', (req, res) => {
    res.clearCookie('admin_token');
    res.redirect('/user/admin');
});

app.listen(PORT, () => {
    console.log(`🚀 Ravenweb berjalan di http://localhost:${PORT}`);
});

module.exports = app;
