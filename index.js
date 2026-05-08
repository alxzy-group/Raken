const express = require('express');
const cors = require('cors');
const path = require('path');
const prismaDb = require('./prisma_db');
const { createTransaction, cancelTransaction } = require('./pakasir');
const config = require('./config');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
            trx = await createTransaction(orderId, harga);
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
            await cancelTransaction(order.id, order.harga);
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
        const status = await prismaDb.getOrderStatus(id);

        if (status) {
            res.json({ status: status });
        } else {
            res.status(404).json({ error: 'Order tidak ditemukan' });
        }
    } catch (e) {
        res.status(500).json({ error: 'Gagal mengecek status' });
    }
});

// API Endpoints for Bots
app.get('/api/orders', async (req, res) => {
    try {
        const { jenis_bot } = req.query;
        let filters = null;
        if (jenis_bot) {
            filters = jenis_bot.split(',');
        }
        const orders = await prismaDb.getPendingOrders(filters);
        res.json(orders);
    } catch (e) {
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

app.listen(PORT, () => {
    console.log(`🚀 Ravenweb berjalan di http://localhost:${PORT}`);
});

module.exports = app;
