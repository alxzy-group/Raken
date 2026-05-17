const { PrismaClient } = require('@prisma/client');

// Use global singleton pattern to prevent duplicate PrismaClient instances in serverless/development
const prisma = global.prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') {
    global.prisma = prisma;
}

async function addOrder(orderData) {
    try {
        // Ensure harga is an integer
        const harga = parseInt(orderData.harga);
        
        return await prisma.order.create({
            data: {
                id: orderData.id,
                email: orderData.email,
                link_group: orderData.link_group,
                info_group: orderData.info_group,
                jenis_bot: orderData.jenis_bot,
                tipe_order: orderData.tipe_order,
                paket: orderData.paket,
                durasi_hari: String(orderData.durasi_hari),
                harga: harga,
                payment_number: orderData.payment_number,
                expired_at: orderData.expired_at,
                status: orderData.status,
                created_at: new Date(orderData.created_at || Date.now())
            }
        });
    } catch (error) {
        console.error('Prisma addOrder error:', error);
        throw error;
    }
}

async function getOrderStatus(orderId) {
    try {
        const order = await prisma.order.findUnique({
            where: { id: orderId }
        });
        return order ? order.status : null;
    } catch (error) {
        console.error('Prisma getOrderStatus error:', error);
        return null;
    }
}

async function getOrder(orderId) {
    try {
        return await prisma.order.findUnique({
            where: { id: orderId }
        });
    } catch (error) {
        console.error('Prisma getOrder error:', error);
        return null;
    }
}

async function updateOrderStatus(orderId, status) {
    try {
        const orderBefore = await prisma.order.findUnique({
            where: { id: orderId }
        });

        const updatedOrder = await prisma.order.update({
            where: { id: orderId },
            data: { status: status },
            include: { group: true }
        });

        // Pemicu notifikasi saat status diubah menjadi PAID atau COMPLETED
        if (orderBefore && orderBefore.status !== status) {
            if (status === 'PAID' || status === 'COMPLETED') {
                sendTelegramNotification(updatedOrder).catch(err => {
                    console.error('Gagal mengirim notifikasi Telegram:', err);
                });
            }
        }

        return updatedOrder;
    } catch (error) {
        console.error('Prisma updateOrderStatus error:', error);
        throw error;
    }
}

async function getSetting(key) {
    try {
        const setting = await prisma.setting.findUnique({
            where: { key }
        });
        return setting ? setting.value : null;
    } catch (error) {
        console.error(`Prisma getSetting error for key ${key}:`, error);
        return null;
    }
}

async function setSetting(key, value) {
    try {
        return await prisma.setting.upsert({
            where: { key },
            update: { value },
            create: { key, value }
        });
    } catch (error) {
        console.error(`Prisma setSetting error for key ${key}:`, error);
        throw error;
    }
}

async function sendTelegramNotification(order) {
    try {
        const botToken = await getSetting('telegram_bot_token');
        const ownerId = await getSetting('telegram_owner_id');

        if (!botToken || !ownerId) {
            console.log('[TELEGRAM] Skip notifikasi: Bot token atau Owner ID belum dikonfigurasi.');
            return;
        }

        const formattedHarga = new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0
        }).format(order.harga).replace('Rp', 'Rp ').trim();

        const groupName = order.group ? order.group.name : 'Menunggu Bot Join...';
        const tipeOrderStr = order.tipe_order ? order.tipe_order.toUpperCase() : 'BARU';

        let jenisBotStr = order.jenis_bot ? order.jenis_bot.toLowerCase() : 'store';
        if (jenisBotStr === 'v3') jenisBotStr = 'guild';
        if (jenisBotStr === 'v4') jenisBotStr = 'cc';
        jenisBotStr = jenisBotStr.toUpperCase();

        // Format pesan sesuai permintaan user
        const message = `💰 *ORDER WEB SUCCESS (${tipeOrderStr})*\n\n` +
            `*Email:* ${order.email}\n` +
            `*Jenis Bot:* ${jenisBotStr}\n` +
            `*Grup:* ${groupName}\n` +
            `*Link:* ${order.link_group}\n` +
            `*Harga:* ${formattedHarga}\n` +
            `*ID:* \`${order.id}\``;

        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: ownerId,
                text: message,
                parse_mode: 'Markdown'
            })
        });

        const resData = await response.json();
        if (response.ok && resData.ok) {
            console.log(`[TELEGRAM] Notifikasi berhasil dikirim untuk order ${order.id}`);
        } else {
            console.error('[TELEGRAM] Gagal mengirim notifikasi Telegram:', resData.description || resData);
        }
    } catch (error) {
        console.error('[TELEGRAM] Error sending Telegram notification:', error);
    }
}

async function getPendingOrders(jenisBot) {
    try {
        const where = {
            status: { in: ['PAID', 'WAITING', 'PENDING'] }
        };
        if (jenisBot) {
            if (Array.isArray(jenisBot)) {
                where.jenis_bot = { in: jenisBot };
            } else {
                where.jenis_bot = jenisBot;
            }
        }
        return await prisma.order.findMany({
            where: where,
            orderBy: { created_at: 'asc' }
        });
    } catch (error) {
        console.error('Prisma getPendingOrders error:', error);
        return [];
    }
}

async function getAllOrders() {
    try {
        return await prisma.order.findMany({
            include: { group: true },
            orderBy: { created_at: 'desc' }
        });
    } catch (error) {
        console.error('Prisma getAllOrders error:', error);
        return [];
    }
}

async function updateGroupInfo(data) {
    try {
        const { orderId, name, photo, jid } = data;
        return await prisma.group.upsert({
            where: { orderId: orderId },
            update: {
                name: name,
                photo: photo,
                jid: jid
            },
            create: {
                orderId: orderId,
                name: name,
                photo: photo,
                jid: jid
            }
        });
    } catch (error) {
        console.error('Prisma updateGroupInfo error:', error);
        throw error;
    }
}

async function syncActiveGroups(groups, jenisBot) {
    try {
        const jidsInRequest = groups.map(g => g.jid);

        // 1. Fetch all existing active groups for this jenisBot in a single query
        const existingGroups = await prisma.activeGroup.findMany({
            where: { jenisBot: jenisBot }
        });
        const existingMap = new Map(existingGroups.map(g => [g.jid, g]));

        const operations = [];

        // 2. Cleanup legacy categories if needed
        if (jenisBot === 'guild') {
            operations.push(prisma.activeGroup.deleteMany({ where: { jenisBot: { in: ['v3', 'V3'] } } }));
        } else if (jenisBot === 'cc') {
            operations.push(prisma.activeGroup.deleteMany({ where: { jenisBot: { in: ['v4', 'V4'] } } }));
        }

        // 3. Delete groups that are no longer in the bot's rental list
        operations.push(prisma.activeGroup.deleteMany({
            where: {
                jenisBot: jenisBot,
                jid: { notIn: jidsInRequest }
            }
        }));

        // 4. Build update and create operations
        for (const group of groups) {
            const existing = existingMap.get(group.jid);

            if (existing) {
                let hasChanged = false;
                const updateData = {};

                // Compare expiredAt (handle both string formats and Date objects safely)
                const existingTime = existing.expiredAt ? new Date(existing.expiredAt).getTime() : 0;
                const incomingTime = group.expiredAt ? new Date(group.expiredAt).getTime() : 0;
                if (existingTime !== incomingTime) {
                    updateData.expiredAt = group.expiredAt;
                    hasChanged = true;
                }

                // Compare memberCount
                const newMemberCount = (group.memberCount && group.memberCount > 0) ? group.memberCount : existing.memberCount;
                if (newMemberCount !== existing.memberCount) {
                    updateData.memberCount = newMemberCount;
                    hasChanged = true;
                }

                // Compare name (avoid overwriting custom values with defaults)
                if (group.name && group.name !== 'Group Tersewa' && group.name !== 'Unnamed Group') {
                    if (group.name !== existing.name) {
                        updateData.name = group.name;
                        hasChanged = true;
                    }
                }

                // Compare photo
                if (group.photo && group.photo !== existing.photo) {
                    updateData.photo = group.photo;
                    hasChanged = true;
                }

                // Only append update operation if there are actual, concrete changes
                if (hasChanged) {
                    operations.push(prisma.activeGroup.update({
                        where: { id: existing.id },
                        data: updateData
                    }));
                }
            } else {
                // New entry, create with whatever we have
                operations.push(prisma.activeGroup.create({
                    data: {
                        jid: group.jid,
                        jenisBot: jenisBot,
                        name: group.name || 'Group Tersewa',
                        photo: group.photo,
                        expiredAt: group.expiredAt,
                        memberCount: group.memberCount || 0
                    }
                }));
            }
        }

        // 5. Execute all operations inside a single, highly efficient transaction
        await prisma.$transaction(operations);
        return true;
    } catch (error) {
        console.error('Prisma syncActiveGroups error:', error);
        throw error;
    }
}

async function getActiveGroups(jenisBot) {
    try {
        const where = {};
        if (jenisBot) where.jenisBot = jenisBot;
        return await prisma.activeGroup.findMany({
            where: where,
            orderBy: { updatedAt: 'desc' }
        });
    } catch (error) {
        console.error('Prisma getActiveGroups error:', error);
        return [];
    }
}

module.exports = { 
    prisma, 
    addOrder, 
    getOrderStatus, 
    getOrder,
    updateOrderStatus, 
    getPendingOrders,
    getAllOrders,
    updateGroupInfo,
    syncActiveGroups,
    getActiveGroups,
    getSetting,
    setSetting,
    sendTelegramNotification
};
