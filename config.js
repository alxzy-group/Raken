global.debug = false; 
module.exports = {
    PAKASIR_KEY: 'egY52Qm9D3WdeFpXoB9nipg5zFfhqDMC',
    PAKASIR_SLUG: 'ravenzena-auto-order',
    GITHUB_TOKEN: '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',
    GITHUB_OWNER: 'alxzy-group',
    GITHUB_REPO: 'alxzydb',
    FILE_PATH: 'orders.json',
    CONTACT_OWNER: [
        { type: 'whatsapp', id: '6282288978160', name: 'Raken Store' },
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
        guild: {
            'paket1': { nama: '1 Minggu', harga: 7000, hari: 7 },
            'paket2': { nama: '1 Bulan', harga: 15000, hari: 30 },
            'paket3': { nama: '2 Bulan', harga: 23000, hari: 60 },
            'paket4': { nama: '3 Bulan', harga: 30000, hari: 90 },
            'paket5': { nama: '4 Bulan', harga: 50000, hari: 120 }
        },
        cc: {
            'paket1': { nama: '1 Minggu', harga: 6000, hari: 7 },
            'paket2': { nama: '1 Bulan', harga: 13000, hari: 30 },
            'paket3': { nama: '2 Bulan', harga: 21000, hari: 60 }
           
        }
    }
};
