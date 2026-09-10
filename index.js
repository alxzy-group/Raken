const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const prismaDb = require('./prisma_db');
const mustika = require('./mustika');
const config = require('./config');
const crypto = require('crypto');
const multer = require('multer');
const pngToIco = require('png-to-ico');
const fs = require('fs');

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Short-lived in-memory sessions keep the admin password out of browser cookies.
const adminSessions = new Map();
const loginAttempts = new Map();
const SESSION_TTL = 24 * 60 * 60 * 1000;
const MAX_BODY_SIZE = '100kb';

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

function safeEqual(left, right) {
    const a = Buffer.from(String(left || ''));
    const b = Buffer.from(String(right || ''));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function getAdminSession(req) {
    const token = req.cookies.admin_token;
    if (!token) return null;
    const session = adminSessions.get(token);
    if (!session || session.expiresAt < Date.now()) {
        adminSessions.delete(token);
        return null;
    }
    return session;
}

function requireAdmin(req, res, next) {
    if (!getAdminSession(req)) {
        if (req.accepts('html')) return res.redirect('/user/admin');
        return res.status(403).json({ success: false, message: 'Akses admin diperlukan.' });
    }
    next();
}

function isValidExternalImage(value) {
    if (!value) return true;
    if (value.startsWith('/')) return true;
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && url.hostname.length > 2;
    } catch {
        return false;
    }
}

function normalizeBotType(type) {
    const value = String(type || '').trim().toLowerCase();
    return value === 'guild' ? 'v3' : value;
}

function voucherMatchesBot(voucherType, orderType) {
    const normalizedVoucher = normalizeBotType(voucherType);
    return normalizedVoucher === 'all' || normalizedVoucher === normalizeBotType(orderType);
}

async function getPricingConfig() {
    let pricingData = config.PRICING || { store: {}, guild: {}, cc: {} };
    try {
        const dbPricing = await prismaDb.getSetting('pricing_config');
        if (dbPricing) {
            const parsed = JSON.parse(dbPricing);
            if (Object.keys(parsed).length > 0) pricingData = parsed;
        }
    } catch (e) {
        console.error('Error parsing pricing_config from DB:', e);
    }
    return pricingData;
}

// Bot API Cache Configuration
let apiCache = {
    orders: new Map(),
    lastUpdate: new Map() // Simpan lastUpdate per key
};
const CACHE_TTL = 5000; // 5 seconds cache

app.use(cors({ origin: process.env.CORS_ORIGIN || false }));
app.use(express.json({ limit: MAX_BODY_SIZE }));
app.use(express.urlencoded({ extended: false, limit: MAX_BODY_SIZE }));
app.use(cookieParser());
app.disable('x-powered-by');
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});
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
    const pricingData = await getPricingConfig();
    const infoGroups = config.INFO_GROUP_LINK || {};
    const contacts = config.CONTACT_OWNER || [];
    const siteSettings = {
        siteName: await prismaDb.getSetting('site_name') || 'Ravenzena Bot',
        logoUrl: await prismaDb.getSetting('site_logo_url') || '/favicon.png',
        faviconUrl: await prismaDb.getSetting('site_favicon_url') || await prismaDb.getSetting('site_logo_url') || '/favicon.png',
        heroImageUrl: await prismaDb.getSetting('site_hero_image_url') || 'https://i.ibb.co.com/23h0hMBg/Beauty-Plus-20260323151557770-save.jpg',
        siteDescription: await prismaDb.getSetting('site_description') || 'Bot WhatsApp yang membantu komunitas tetap rapi, aktif, dan mudah dikelola.',
        whatsappNumber1: await prismaDb.getSetting('site_wa_1') || '',
        whatsappNumber2: await prismaDb.getSetting('site_wa_2') || '',
        whatsappNumber3: await prismaDb.getSetting('site_wa_3') || '',
        whatsappNumber4: await prismaDb.getSetting('site_wa_4') || '',
        freeGroupLink: await prismaDb.getSetting('site_free_group_link') || ''
    };

    if (req.query.checkout) {
        try {
            const order = await prismaDb.getOrder(req.query.checkout);
            if (order) {
                return res.render('index', {
                    pricing: pricingData,
                    contacts: contacts,
                    infoGroups: infoGroups,
                    siteSettings,
                    orderId: order.id,
                    qris: order.payment_number,
                    harga: order.harga,
                    status: order.status,
                    jenis_bot: order.jenis_bot
                });
            }
        } catch (e) {
            console.error('Render error:', e);
        }
    }
    res.render('index', {
        pricing: pricingData,
        contacts: contacts,
        infoGroups: infoGroups,
        siteSettings,
        orderId: null,
        qris: null,
        harga: 0,
        status: 'PENDING',
        jenis_bot: 'store'
    });
});

app.post('/checkout', async (req, res) => {
    try {
        const { email, link_group, jenis_bot, tipe_order, paket, voucher_code } = req.body;
        const pricingData = await getPricingConfig();
        const infoGroups = config.INFO_GROUP_LINK || {};

        const validGroupUrl = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+$/i.test(String(link_group));
        const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email)) && String(email).length <= 160;
        const allowedBotTypes = ['store', 'v3', 'guild', 'cc'];
        const allowedOrderTypes = ['baru', 'perpanjang'];
        if (!validEmail || !validGroupUrl || !allowedBotTypes.includes(jenis_bot) || !allowedOrderTypes.includes(tipe_order) || !paket || !pricingData[jenis_bot] || !pricingData[jenis_bot][paket]) {
            return res.status(400).json({ success: false, message: 'Data tidak valid. Periksa email, link grup, dan pilihan paket.' });
        }

        let harga = pricingData[jenis_bot][paket].harga;
        const hari = pricingData[jenis_bot][paket].hari;
        const orderId = 'ORD-' + Date.now();
        const groupInfoLink = infoGroups[jenis_bot] || '#';

        let appliedVoucher = null;
        if (voucher_code) {
            const voucher = await prismaDb.getVoucherByCode(voucher_code.toUpperCase());
            if (voucher && voucher.isActive && (voucher.maxUsage === 0 || voucher.usedCount < voucher.maxUsage)) {
                let valid = true;
                if (voucher.expiry && new Date(voucher.expiry) < new Date()) valid = false;
                if (!voucherMatchesBot(voucher.jenisBot, jenis_bot)) valid = false;

                if (valid) {
                    if (voucher.type === 'percent') {
                        harga = harga - (harga * (voucher.discount / 100));
                    } else {
                        harga = harga - voucher.discount;
                    }
                    if (harga < 0) harga = 0;
                    appliedVoucher = voucher;
                }
            }
        }

        harga = Math.round(harga);

        let trx;
        let finalStatus = 'PENDING';

        if (global.debug) {
            const expiredWIB = new Date(Date.now() + (200 * 5000)).toLocaleTimeString('id-ID', {
                hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta', hour12: false
            }).replace('.', ':');

            trx = {
                payment_number: 'DEBUG-QRIS',
                ref_no: 'DEBUG-REF',
                expired_at: expiredWIB
            };
        } else {
            trx = await mustika.createTransaction(orderId, harga);
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
            ref_no: trx.ref_no,
            expired_at: trx.expired_at,
            status: finalStatus,
            voucher_code: appliedVoucher ? appliedVoucher.code : null,
            created_at: new Date().toISOString()
        };
        await prismaDb.addOrder(orderData);

        if (appliedVoucher) {
            await prismaDb.incrementVoucherUsage(appliedVoucher.id);
        }

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

app.post('/api/validate-voucher', async (req, res) => {
    try {
        const { code, jenis_bot } = req.body;
        if (!code || String(code).length > 40 || !['store', 'v3', 'guild', 'cc'].includes(jenis_bot)) return res.status(400).json({ error: 'Kode voucher tidak valid' });

        const voucher = await prismaDb.getVoucherByCode(code.toUpperCase());
        if (!voucher) return res.status(404).json({ error: 'Voucher tidak ditemukan' });

        if (!voucher.isActive) return res.status(400).json({ error: 'Voucher sudah tidak aktif' });

        if (voucher.maxUsage > 0 && voucher.usedCount >= voucher.maxUsage) {
            return res.status(400).json({ error: 'Batas penggunaan voucher sudah habis' });
        }

        if (voucher.expiry && new Date(voucher.expiry) < new Date()) {
            return res.status(400).json({ error: 'Voucher sudah kadaluwarsa' });
        }

        if (!voucherMatchesBot(voucher.jenisBot, jenis_bot)) {
            const voucherLabel = normalizeBotType(voucher.jenisBot) === 'v3' ? 'GUILD' : String(voucher.jenisBot).toUpperCase();
            return res.status(400).json({ error: `Voucher ini hanya untuk ${voucherLabel}` });
        }

        res.json({ success: true, discount: voucher.discount, type: voucher.type });
    } catch (e) {
        console.error('Validate voucher error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/cancel/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const order = await prismaDb.getOrder(id);

        if (order && order.status === 'PENDING') {
            await mustika.cancelTransaction(order.id, order.harga);
            await prismaDb.updateOrderStatus(id, 'CANCELLED');
            res.json({ success: true, message: 'Transaksi berhasil dibatalkan.' });
        } else {
            res.status(400).json({ success: false, message: 'Transaksi tidak ditemukan atau sudah tidak pending.' });
        }
    } catch (e) {
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

            // Cek status asli ke MustikaPay
            const detail = await mustika.getTransactionDetail(order.pakasir);
            if (detail && detail.status === 'success') {
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
        const normalizedStatus = String(status || '').toUpperCase();
        const allowedStatuses = ['PENDING', 'PAID', 'WAITING', 'COMPLETED', 'CANCELLED', 'ERROR'];
        if (!id || !allowedStatuses.includes(normalizedStatus)) {
            return res.status(400).json({ error: 'Status order tidak valid' });
        }
        await prismaDb.updateOrderStatus(id, normalizedStatus);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/groups/update', async (req, res) => {
    try {
        const { orderId, name, photo, jid } = req.body;
        if (!orderId || String(name || '').length > 120 || String(jid || '').length > 80 || !isValidExternalImage(photo)) {
            return res.status(400).json({ error: 'Data grup tidak valid' });
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
        if (!Array.isArray(groups) || groups.length > 500 || !['store', 'v3', 'guild', 'cc'].includes(jenis_bot)) {
            return res.status(400).json({ error: 'Data sinkronisasi tidak valid' });
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
    if (getAdminSession(req)) return res.redirect('/user/admin/dashboard');
    res.render('admin_login', { error: null });
});

app.post('/user/admin', (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const attempt = loginAttempts.get(ip) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
    if (attempt.resetAt < Date.now()) { attempt.count = 0; attempt.resetAt = Date.now() + 15 * 60 * 1000; }
    if (attempt.count >= 8) return res.status(429).render('admin_login', { error: 'Terlalu banyak percobaan. Coba lagi nanti.' });

    const { username, password } = req.body;
    const valid = safeEqual(username, 'admin') && safeEqual(password, config.ADMIN_PASSWORD);
    if (valid) {
        loginAttempts.delete(ip);
        const token = crypto.randomBytes(32).toString('hex');
        adminSessions.set(token, { createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL });
        res.cookie('admin_token', token, {
            maxAge: SESSION_TTL,
            httpOnly: true,
            sameSite: 'lax',
            secure: isProduction
        });
        return res.redirect('/user/admin/dashboard');
    }
    attempt.count += 1;
    loginAttempts.set(ip, attempt);
    res.status(401).render('admin_login', { error: 'Username atau password tidak cocok.' });
});

app.get('/user/admin/dashboard', requireAdmin, async (req, res) => {
    // Trigger update pembayaran pending secara non-blocking saat admin membuka dashboard
    pollPendingPayments().catch(err => console.error('[POLLER] Dashboard poll error:', err));

    try {
        const orders = await prismaDb.getAllOrders();
        const activeGroups = await prismaDb.getActiveGroups();
        const telegramBotToken = await prismaDb.getSetting('telegram_bot_token') || '';
        const telegramOwnerId = await prismaDb.getSetting('telegram_owner_id') || '';
        const mustikaApiKey = await prismaDb.getSetting('mustika_api_key') || '';
        const vouchers = await prismaDb.getAllVouchers();
        const siteSettings = {
            siteName: await prismaDb.getSetting('site_name') || 'Ravenzena Bot',
            logoUrl: await prismaDb.getSetting('site_logo_url') || '/favicon.png',
            faviconUrl: await prismaDb.getSetting('site_favicon_url') || '',
            heroImageUrl: await prismaDb.getSetting('site_hero_image_url') || '',
            siteDescription: await prismaDb.getSetting('site_description') || '',
            whatsappNumber1: await prismaDb.getSetting('site_wa_1') || '',
            whatsappNumber2: await prismaDb.getSetting('site_wa_2') || '',
            whatsappNumber3: await prismaDb.getSetting('site_wa_3') || '',
            whatsappNumber4: await prismaDb.getSetting('site_wa_4') || '',
            freeGroupLink: await prismaDb.getSetting('site_free_group_link') || ''
        };

        res.render('admin_dashboard', {
            orders,
            activeGroups,
            telegramBotToken,
            telegramOwnerId,
            mustikaApiKey,
            vouchers,
            siteSettings
        });
    } catch (e) {
        console.error('Error rendering dashboard:', e);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/user/admin/pricing', requireAdmin, async (req, res) => {
    try {
        const currentPricing = await getPricingConfig();
        res.json({ success: true, data: currentPricing });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error saat mengambil data harga' });
    }
});

app.post('/user/admin/pricing', requireAdmin, async (req, res) => {
    try {
        const newPricing = req.body.pricing;
        if (!newPricing || typeof newPricing !== 'object') {
            return res.status(400).json({ success: false, message: 'Format data harga tidak valid' });
        }
        await prismaDb.setSetting('pricing_config', JSON.stringify(newPricing));
        res.json({ success: true, message: 'Konfigurasi Harga berhasil disimpan!' });
    } catch (error) {
        console.error('Pricing Save Error:', error);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan server saat menyimpan harga.' });
    }
});

app.post('/user/admin/upload', upload.single('file'), async (req, res) => {
    try {
        if (!getAdminSession(req)) return res.status(403).json({ success: false, message: 'Akses ditolak.' });
        
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Tidak ada file yang diupload.' });
        }
        
        let fileUrl = `/uploads/${req.file.filename}`;
        
        if (req.body.convertToIco === 'true') {
            try {
                // Determine source for png-to-ico (only works with png directly or buf)
                // Since png-to-ico expects png, we assume it's valid. If it fails, fallback to png URL.
                const icoPath = path.join(__dirname, 'public', 'uploads', Date.now() + '.ico');
                const buf = await pngToIco(req.file.path);
                fs.writeFileSync(icoPath, buf);
                fileUrl = `/uploads/${path.basename(icoPath)}`;
            } catch (err) {
                console.error('Failed to convert to ICO:', err);
                // Fallback to the original uploaded file if conversion fails
            }
        }
        
        res.json({ success: true, url: fileUrl });
    } catch (e) {
        console.error('Upload Error:', e);
        res.status(500).json({ success: false, message: 'Gagal mengupload file.' });
    }
});

app.post('/user/admin/settings', async (req, res) => {
    try {
        if (!getAdminSession(req)) return res.status(403).json({ success: false, message: 'Akses ditolak.' });

        const { telegramBotToken, telegramOwnerId, mustikaApiKey, siteName, logoUrl, faviconUrl, heroImageUrl, siteDescription, whatsappNumber1, whatsappNumber2, whatsappNumber3, whatsappNumber4, freeGroupLink } = req.body;

        if (![logoUrl, faviconUrl, heroImageUrl].every(isValidExternalImage)) {
            return res.status(400).json({ success: false, message: 'URL gambar harus menggunakan http atau https yang valid atau path relatif.' });
        }

        await prismaDb.setSetting('telegram_bot_token', String(telegramBotToken || '').trim());
        await prismaDb.setSetting('telegram_owner_id', String(telegramOwnerId || '').trim());
        await prismaDb.setSetting('mustika_api_key', String(mustikaApiKey || '').trim());
        
        await prismaDb.setSetting('site_name', String(siteName || '').trim());
        await prismaDb.setSetting('site_logo_url', String(logoUrl || '').trim());
        await prismaDb.setSetting('site_favicon_url', String(faviconUrl || '').trim());
        await prismaDb.setSetting('site_hero_image_url', String(heroImageUrl || '').trim());
        await prismaDb.setSetting('site_description', String(siteDescription || '').trim());
        
        const clean = num => {
            let cl = String(num || '').replace(/\D/g, '');
            if (cl.startsWith('0')) cl = '62' + cl.substring(1);
            return cl;
        };
        await prismaDb.setSetting('site_wa_1', clean(whatsappNumber1));
        await prismaDb.setSetting('site_wa_2', clean(whatsappNumber2));
        await prismaDb.setSetting('site_wa_3', clean(whatsappNumber3));
        await prismaDb.setSetting('site_wa_4', clean(whatsappNumber4));
        
        await prismaDb.setSetting('site_free_group_link', String(freeGroupLink || '').trim());

        res.json({ success: true, message: 'Pengaturan berhasil disimpan!' });
    } catch (error) {
        console.error('Save Settings Error:', error);
        res.status(500).json({ success: false, message: 'Gagal menyimpan pengaturan.' });
    }
});

app.post('/user/admin/vouchers', requireAdmin, async (req, res) => {
    try {
        const { code, discount, maxUsage, expiry, jenisBot } = req.body;
        const normalizedBotType = normalizeBotType(jenisBot || 'all');
        const normalizedCode = String(code || '').trim().toUpperCase();
        const normalizedDiscount = Number(discount);
        const normalizedMaxUsage = Number(maxUsage || 0);

        if (!/^[A-Z0-9_-]{3,40}$/.test(normalizedCode) ||
            !Number.isFinite(normalizedDiscount) || normalizedDiscount <= 0 || normalizedDiscount > 100 ||
            !Number.isInteger(normalizedMaxUsage) || normalizedMaxUsage < 0 ||
            !['all', 'store', 'v3', 'cc'].includes(normalizedBotType)) {
            return res.status(400).json({ success: false, message: 'Data voucher tidak valid.' });
        }

        await prismaDb.createVoucher({
            code: normalizedCode,
            discount: normalizedDiscount,
            type: 'percent',
            maxUsage: normalizedMaxUsage,
            expiry: expiry ? new Date(expiry) : null,
            jenisBot: normalizedBotType
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.delete('/user/admin/vouchers/:id', requireAdmin, async (req, res) => {
    try {
        await prismaDb.deleteVoucher(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/user/admin/logout', (req, res) => {
    const token = req.cookies.admin_token;
    if (token) adminSessions.delete(token);
    res.clearCookie('admin_token', { httpOnly: true, sameSite: 'lax', secure: isProduction });
    res.redirect('/user/admin');
});


// =============================================
// BACKGROUND POLLER: Cek pembayaran PENDING ke MustikaPay setiap 12 detik
// Tidak bergantung pada browser user tetap terbuka
// =============================================
async function pollPendingPayments() {
    try {
        const pendingOrders = await prismaDb.getPendingOrders(null);
        const onlyPending = pendingOrders.filter(o => o.status === 'PENDING' && o.payment_number !== 'DEBUG-QRIS');

        if (onlyPending.length === 0) return;

        console.log(`[POLLER] Mengecek ${onlyPending.length} order PENDING ke MustikaPay...`);

        for (const order of onlyPending) {
            try {
                const detail = await mustika.getTransactionDetail(order.pakasir);
                if (detail && detail.status === 'success') {
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
        console.error('[POLLER] Error saat polling MustikaPay:', e.message);
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
