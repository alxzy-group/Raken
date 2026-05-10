const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

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
        return await prisma.order.update({
            where: { id: orderId },
            data: { status: status }
        });
    } catch (error) {
        console.error('Prisma updateOrderStatus error:', error);
        throw error;
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
        // 1. Delete old data for this bot type to ensure real-time sync
        await prisma.activeGroup.deleteMany({
            where: { jenisBot: jenisBot }
        });

        // 2. Insert the latest data from the bot
        if (groups.length > 0) {
            const dataToInsert = groups.map(group => ({
                jid: group.jid,
                jenisBot: jenisBot,
                name: group.name,
                photo: group.photo,
                expiredAt: group.expiredAt
            }));

            await prisma.activeGroup.createMany({
                data: dataToInsert
            });
        }
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
    getActiveGroups
};
