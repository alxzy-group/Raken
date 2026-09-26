const axios = require('axios');
const crypto = require('crypto');
const prismaDb = require('./prisma_db');

const BASE_URL = 'https://austinstore.id';
let timeOffset = 0;
let isTimeSynced = false;

async function getApiKeys() {
    const apiKey = await prismaDb.getSetting('austin_api_key');
    const apiSecret = (await prismaDb.getSetting('austin_api_secret')) || apiKey;
    if (!apiKey) {
        throw new Error('AustinPay API Key belum dikonfigurasi di Admin Dashboard.');
    }
    return { apiKey, apiSecret };
}

async function getRealTimestamp() {
    if (!isTimeSynced) {
        try {
            const start = Date.now();
            const res = await axios.head(BASE_URL);
            const dateHeader = res.headers['date'];
            
            if (dateHeader) {
                const serverTimeMs = new Date(dateHeader).getTime();
                const latency = (Date.now() - start) / 2;
                const realTimeMs = serverTimeMs + latency;
                timeOffset = realTimeMs - Date.now();
                isTimeSynced = true;
                console.log(`[AustinPay] Synced time with Austin server. Offset: ${timeOffset}ms`);
            } else {
                throw new Error('No Date header found');
            }
        } catch (e) {
            console.error('[AustinPay] Time sync error, using system time:', e.message);
        }
    }
    return Math.floor(Date.now() + timeOffset).toString(); // in milliseconds
}

async function buildHmacHeaders(method, path, bodyStr, apiKey, apiSecret) {
    const timestamp = await getRealTimestamp();
    const payload = `${method.toUpperCase()}\n${path}\n${bodyStr}\n${timestamp}`;
    
    const signature = crypto
        .createHmac('sha256', apiSecret)
        .update(payload)
        .digest('hex');

    return {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'X-Timestamp': timestamp,
        'X-Signature': signature,
    };
}

async function createTransaction(orderId, amount) {
    try {
        const { apiKey, apiSecret } = await getApiKeys();
        const path = `/api/deposit/create`;
        const url = `${BASE_URL}${path}`;
        const bodyStr = JSON.stringify({ amount });

        const res = await axios.post(url, bodyStr, {
            headers: await buildHmacHeaders('POST', path, bodyStr, apiKey, apiSecret),
            validateStatus: () => true
        });

        const data = res.data;
        if (res.status !== 200 || !data.success) {
            throw new Error(data.message || `HTTP ${res.status}`);
        }

        const depositObj = data.deposit || data.data || data;
        
        return {
            payment_number: depositObj.qr_image || depositObj.qr_url || (depositObj.qr_string ? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(depositObj.qr_string)}` : ''),
            ref_no: depositObj.transaction_id || depositObj.id,
            amount: depositObj.amount || depositObj.total_amount || amount,
            expired_at: 'PERMANENT'
        };
    } catch (error) {
        console.error('AustinPay createTransaction error:', error.message);
        throw error;
    }
}

async function cancelTransaction(orderId, amount) {
    try {
        const { apiKey, apiSecret } = await getApiKeys();
        const path = `/api/deposit/cancel/${orderId}`;
        const url = `${BASE_URL}${path}`;

        const res = await axios.post(url, '', {
            headers: await buildHmacHeaders('POST', path, '', apiKey, apiSecret),
            validateStatus: () => true
        });
        const data = res.data;
        return { success: data.success, message: data.message, status: data.status };
    } catch (err) {
        console.error('[AustinPay] cancelTransaction error:', err.message);
        return { success: false, message: err.message };
    }
}

/**
 * Cek status deposit — persis ngikutin pola referensi alxzy auto order
 * Return: { success: true/false, status: "paid"/"pending"/"expired", message: "..." }
 */
async function getTransactionDetail(refNo) {
    try {
        if (!refNo) return { success: false, message: 'No ref_no' };
        const { apiKey, apiSecret } = await getApiKeys();
        const path = `/api/deposit/check/${refNo}`;
        const url = `${BASE_URL}${path}`;

        const res = await axios.get(url, {
            headers: await buildHmacHeaders('GET', path, '', apiKey, apiSecret),
            validateStatus: () => true
        });

        const data = res.data;

        // Kalau kena rate limit (429) atau server error, return gagal tapi JANGAN crash
        if (res.status === 429) {
            console.warn(`[AustinPay] Rate limited for ${refNo}, skip...`);
            return { success: false, message: 'Rate limited' };
        }

        if (res.status !== 200) {
            console.warn(`[AustinPay] HTTP ${res.status} for ${refNo}: ${data.message || ''}`);
            return { success: false, message: data.message || `HTTP ${res.status}` };
        }

        // Return persis seperti referensi alxzy: { success, status, message }
        console.log(`[AustinPay] Check ${refNo} => status: ${data.status}, message: ${data.message}`);
        return { success: true, status: data.status, message: data.message };
    } catch (error) {
        console.error('AustinPay getTransactionDetail error:', error.message);
        return { success: false, message: error.message };
    }
}

module.exports = { createTransaction, cancelTransaction, getTransactionDetail };
