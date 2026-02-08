const https = require('https');

const CURRENCY_API_URL = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json';

let ratesCache = null;
let lastFetch = 0;
const CACHE_DURATION = 1000 * 60 * 60 * 12; // 12 hours

const fetchRates = () => {
    return new Promise((resolve, reject) => {
        https.get(CURRENCY_API_URL, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    ratesCache = json.usd;
                    lastFetch = Date.now();
                    resolve(ratesCache);
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', (err) => reject(err));
    });
};

const getRates = async () => {
    if (!ratesCache || (Date.now() - lastFetch > CACHE_DURATION)) {
        try {
            await fetchRates();
        } catch (e) {
            console.error('Failed to fetch exchange rates, using fallback:', e);
            // Minimal fallback rates
            ratesCache = ratesCache || { usd: 1, inr: 83, eur: 0.92, gbp: 0.79, jpy: 150 };
        }
    }
    return ratesCache;
};

const convert = async (amount, from, to) => {
    const rates = await getRates();
    // Convert to USD first
    const inUsd = amount / (rates[from.toLowerCase()] || 1);
    // Convert from USD to target
    return inUsd * (rates[to.toLowerCase()] || 1);
};

module.exports = { getRates, convert };
