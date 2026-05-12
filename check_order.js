
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkOrder(id) {
    try {
        const order = await prisma.order.findUnique({
            where: { id }
        });
        if (order) {
            console.log('--- ORDER DETAIL ---');
            console.log(JSON.stringify(order, null, 2));
        } else {
            console.log('Order not found:', id);
        }
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

checkOrder('ORD-1778591105968');
