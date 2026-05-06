const axios = require('axios');
const config = require('./config');

const GITHUB_TOKEN = config.GITHUB_TOKEN;
const GITHUB_OWNER = config.GITHUB_OWNER; 
const GITHUB_REPO = config.GITHUB_REPO;
const FILE_PATH = config.FILE_PATH;

const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;

async function getDB() {
    try {
        const response = await axios.get(GITHUB_API_URL, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        const content = Buffer.from(response.data.content, 'base64').toString('utf8');
        return {
            data: JSON.parse(content),
            sha: response.data.sha
        };
    } catch (error) {
        if (error.response && error.response.status === 404) {
            return { data: [], sha: null };
        }
        throw error;
    }
}

async function saveDB(dataArray, sha) {
    try {
        const contentBase64 = Buffer.from(JSON.stringify(dataArray, null, 2)).toString('base64');

        const payload = {
            message: 'Auto-update orders from Web',
            content: contentBase64
        };

        if (sha) {
            payload.sha = sha;
        }

        await axios.put(GITHUB_API_URL, payload, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
    } catch (error) {
        throw error;
    }
}

async function addOrder(orderData) {
    let retries = 3;
    while (retries > 0) {
        try {
            const db = await getDB();
            db.data.push(orderData);
            await saveDB(db.data, db.sha);
            return true;
        } catch (error) {
            if (error.response && error.response.status === 409) {
                retries--;
                await new Promise(r => setTimeout(r, 1000));
            } else {
                throw error;
            }
        }
    }
    throw new Error("Conflict");
}

async function getOrderStatus(orderId) {
    const db = await getDB();
    const order = db.data.find(o => o.id === orderId);
    return order ? order.status : null;
}

module.exports = { getDB, saveDB, addOrder, getOrderStatus };
