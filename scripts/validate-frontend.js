const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const templatePath = path.join(__dirname, '..', 'views', 'index.ejs');
const template = fs.readFileSync(templatePath, 'utf8');

const malformedDelimiter = /<%\s+[=+-]/;
if (malformedDelimiter.test(template)) {
    throw new Error('Malformed EJS delimiter found in views/index.ejs. Keep <%= and <%- contiguous.');
}

const html = ejs.render(template, {
    siteSettings: {
        siteName: 'Frontend validation',
        siteDescription: 'Frontend validation fixture',
        logoUrl: '/favicon.png',
        heroImageUrl: ''
    },
    pricing: {
        store: {
            paket2: {
                nama: 'Validation package',
                harga: 10000
            }
        }
    },
    contacts: [],
    infoGroups: {},
    orderId: '',
    qris: '',
    harga: 0,
    status: 'PENDING',
    jenis_bot: 'store'
});

const inlineScripts = html
    .split('<script')
    .slice(1)
    .map((script) => script.split('</script>')[0].replace(/^[^>]*>/, ''))
    .filter((script) => script.trim());

inlineScripts.forEach((script, index) => {
    try {
        new Function(script);
    } catch (error) {
        throw new Error(`Rendered inline script ${index + 1} is invalid: ${error.message}`);
    }
});

const requiredMarkers = [
    "Alpine.data('ravenApp'",
    'x-data="ravenApp"',
    '@click="toggleTheme($event)"',
    'pointer-events: none'
];

requiredMarkers.forEach((marker) => {
    if (!html.includes(marker)) {
        throw new Error(`Required frontend marker is missing: ${marker}`);
    }
});

console.log(`Frontend validation passed (${inlineScripts.length} inline scripts parsed).`);
