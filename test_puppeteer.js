const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  // Listen for console logs and errors
  page.on('console', msg => {
      console.log('PAGE LOG:', msg.text());
  });
  page.on('pageerror', err => {
      console.log('PAGE ERROR:', err.toString());
  });
  
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
  
  // Check if x-cloak is still present
  const cloaked = await page.$$eval('[x-cloak]', els => els.length);
  console.log('Elements with x-cloak remaining:', cloaked);
  
  // Check what view is active
  const homeDisplay = await page.$eval("[x-show=\"view === 'home'\"]", el => window.getComputedStyle(el).display);
  console.log('Home view display:', homeDisplay);
  
  await browser.close();
})();
