const axios = require('axios');
const config = require('./config');

const PAKASIR_KEY = config.PAKASIR_KEY;
const PAKASIR_SLUG = config.PAKASIR_SLUG;

const BASE_URL = 'https://app.pakasir.com/api';

async function createTransaction(orderId, amount) {
    try {
        const payload = {
            project: PAKASIR_SLUG,
            order_id: orderId,
            amount: parseInt(amount),
            api_key: PAKASIR_KEY
        };

        const response = await fetch(`${BASE_URL}/transactioncreate/qris`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message);
        }

        const expiredWIB = new Date(Date.now() + (200 * 5000)).toLocaleTimeString('id-ID', {
            hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta', hour12: false
        }).replace('.', ':');

        return {
            trx_id: data.payment?.trx_id || orderId,
            payment_number: data.payment?.payment_number,
            total_payment: data.payment?.total_payment || amount,
            expired_at: expiredWIB
        };
    } catch (error) {
        throw error;
    }
}

async function cancelTransaction(orderId, amount) {
    try {
        const payload = {
            project: PAKASIR_SLUG,
            order_id: orderId,
            amount: parseInt(amount),
            api_key: PAKASIR_KEY
        };

        const response = await fetch(`${BASE_URL}/transactioncancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return null;
    }
}

module.exports = { createTransaction, cancelTransaction };
