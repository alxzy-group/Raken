const MustikaPay = require('mustikapay-node');
const prismaDb = require('./prisma_db');

let mpInstance = null;
let currentApiKey = null;

async function getMustikaPay() {
    const apiKey = await prismaDb.getSetting('mustika_api_key');
    if (!apiKey) {
        throw new Error('MustikaPay API Key belum dikonfigurasi di Admin Dashboard.');
    }
    
    if (!mpInstance || currentApiKey !== apiKey) {
        mpInstance = new MustikaPay({ apiKey });
        currentApiKey = apiKey;
    }
    return mpInstance;
}

async function createTransaction(orderId, amount) {
    try {
        const mp = await getMustikaPay();
        const response = await mp.createQris(amount);
        
        if (response.status !== 'success') {
            throw new Error(`Gagal membuat transaksi MustikaPay: ${response.message || 'Unknown Error'}`);
        }
        
        // MustikaPay directly returns fields on the response object
        const urlObj = new URL(response.qr_url);
        const qrString = urlObj.searchParams.get('data');

        return {
            payment_number: qrString || response.qr_url, // fallback if data param is missing
            ref_no: response.ref_no,
            expired_at: 'PERMANENT'
        };
    } catch (error) {
        console.error('MustikaPay createTransaction error:', error.message);
        throw error;
    }
}

async function cancelTransaction(orderId, amount) {
    console.log(`[MUSTIKAPAY CANCEL] Requested cancel for order ${orderId}, amount ${amount}`);
    return { success: true, message: 'Transaksi dibatalkan secara lokal.' };
}

async function getTransactionDetail(refNo) {
    try {
        if (!refNo) return null;
        const mp = await getMustikaPay();
        const response = await mp.checkQrisStatus(refNo);
        
        if (!response || !response.status) {
            throw new Error(`Gagal mengambil detail transaksi MustikaPay: ${response ? response.message : 'Unknown Error'}`);
        }
        
        return response; 
    } catch (error) {
        console.error('MustikaPay getTransactionDetail error:', error.message);
        return null;
    }
}

module.exports = { createTransaction, cancelTransaction, getTransactionDetail };
