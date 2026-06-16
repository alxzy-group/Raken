require('dotenv').config();

global.debug = false;
module.exports = {
    PAKASIR_KEY: process.env.PAKASIR_KEY || 'egY52Qm9D3WdeFpXoB9nipg5zFfhqDMC',
    PAKASIR_SLUG: 'ravenzena-auto-order',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin123',
    CONTACT_OWNER: [
        { type: 'whatsapp', id: '6285147084529', name: 'Raken Store' },
        { type: 'whatsapp', id: '6285658762303', name: 'Venn Store' },
        { type: 'whatsapp', id: '6283180602352', name: 'Zize Store' },
        { type: 'whatsapp', id: '6281949574876', name: 'Nayla Store' }
    ],
    PRICING: {
        store: {
            'paket1': { nama: '1 Minggu', harga: 5000, hari: 7 },
            'paket2': { nama: '1 Bulan', harga: 10000, hari: 30 },
            'paket3': { nama: '2 Bulan', harga: 18000, hari: 60 }
        },
        v3: {
            'paket1': { nama: '1 Bulan', harga: 18000, hari: 30 },
            'paket2': { nama: '2 Bulan', harga: 27000, hari: 60 },
            'paket3': { nama: '3 Bulan', harga: 35000, hari: 90 }
        },
        cc: {
            'paket1': { nama: '1 Bulan', harga: 15000, hari: 30 },
            'paket2': { nama: '2 Bulan', harga: 25000, hari: 60 }
        }
    },
    INFO_GROUP_LINK: {
        store: 'https://chat.whatsapp.com/Ew4N1TYPtuN8Il3ADZ0J9y',
        v3: 'https://chat.whatsapp.com/KZHbXWdMWluCGmvo9SUOzA',
        cc: 'https://chat.whatsapp.com/JSuVPInZuG56IBGxYTs3u7'
    }
};
