const sharp = require('sharp');
const mod = require('png-to-ico');
const pngToIco = mod.default || mod;

async function test() {
    try {
        const buf1 = await sharp({
            create: {
                width: 256,
                height: 256,
                channels: 4,
                background: { r: 255, g: 0, b: 0, alpha: 1 }
            }
        }).png().toBuffer();
        
        const buf2 = await pngToIco(buf1);
        console.log('SUCCESS');
    } catch (e) {
        console.error('ERROR', e);
    }
}
test();
