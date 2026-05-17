
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkOrdersByLink(link) {
    try {
        const orders = await prisma.order.findMany({
            where: { link_group: link },
            orderBy: { created_at: 'desc' },
            take: 5
        });
        console.log('--- ORDERS FOR LINK ---');
        console.log(JSON.stringify(orders, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

checkOrdersByLink('https://chat.whatsapp.com/BsIZoDlK6C71g4qfecmbyK');
