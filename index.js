const express = require('express');
const cors = require('cors');
const path = require('path');
const githubDb = require('./github_db');
const { createTransaction, cancelTransaction } = require('./pakasir');
const config = require('./config');

const app = express();
const PORT = 3000;

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
    if (req.query.checkout) {
        try {
            const db = await githubDb.getDB();
            const order = db.data.find(o => o.id === req.query.checkout);
            if (order) {
                return res.render('index', { 
                    pricing: config.PRICING, 
                    contacts: config.CONTACT_OWNER,
                    infoGroups: config.INFO_GROUP_LINK,
                    orderId: order.id, 
                    qris: order.payment_number,
                    harga: order.harga,
                    status: order.status,
                    jenis_bot: order.jenis_bot
                });
            }
        } catch(e) {}
    }
    res.render('index', { 
        pricing: config.PRICING, 
        contacts: config.CONTACT_OWNER,
        infoGroups: config.INFO_GROUP_LINK,
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
        
        if (!email || !link_group || !jenis_bot || !tipe_order || !paket || !config.PRICING[jenis_bot] || !config.PRICING[jenis_bot][paket]) {
            return res.status(400).send('Data tidak valid. Pastikan semua field terisi.');
        }

        const harga = config.PRICING[jenis_bot][paket].harga;
        const hari = config.PRICING[jenis_bot][paket].hari;
        const orderId = 'ORD-' + Date.now();
        const groupInfoLink = config.INFO_GROUP_LINK[jenis_bot] || '#';

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
        await githubDb.addOrder(orderData);

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
        const db = await githubDb.getDB();
        const orderIndex = db.data.findIndex(o => o.id === id);
        
        if (orderIndex !== -1 && db.data[orderIndex].status === 'PENDING') {
            const order = db.data[orderIndex];
            await cancelTransaction(order.id, order.harga);
            
            db.data[orderIndex].status = 'CANCELLED';
            await githubDb.saveDB(db.data, db.sha);
            
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
        const status = await githubDb.getOrderStatus(id);

        if (status) {
            res.json({ status: status });
        } else {
            res.status(404).json({ error: 'Order tidak ditemukan' });
        }
    } catch (e) {
        res.status(500).json({ error: 'Gagal mengecek status' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Ravenweb berjalan di http://localhost:${PORT}`);
});
