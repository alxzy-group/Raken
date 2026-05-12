
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkOrders() {
    try {
        const orders = await prisma.order.findMany({
            where: {
                status: { in: ['PAID', 'WAITING', 'ERROR'] }
            },
            orderBy: { created_at: 'desc' },
            take: 10
        });

        console.log('--- LATEST PAID/WAITING/ERROR ORDERS ---');
        orders.forEach(o => {
            console.log(`ID: ${o.id} | Status: ${o.status} | Bot: ${o.jenis_bot} | Tipe: ${o.tipe_order}`);
        });

        const counts = await prisma.order.groupBy({
            by: ['status'],
            _count: true
        });
        console.log('\n--- STATUS COUNTS ---');
        console.log(counts);

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

checkOrders();
