const fs = require('fs');
const html = fs.readFileSync('views/index.ejs', 'utf8');
const scriptMatches = html.match(/<script([\s\S]*?)>([\s\S]*?)<\/script>/g);
if (scriptMatches) {
    for (let i = 0; i < scriptMatches.length; i++) {
        const script = scriptMatches[i]
            .replace(/<script[\s\S]*?>/g, '')
            .replace(/<\/script>/g, '')
            .replace(/<%.*?%>/g, '"mock"')
            .replace(/<%-.*?%>/g, '"mock"');
        
        try {
            new (require('vm').Script)(script);
            console.log(`Script ${i} OK`);
        } catch(e) {
            console.error(`Syntax error in script ${i}:`, e.message);
            console.log(script.substring(0, 200));
        }
    }
}
