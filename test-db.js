require('dotenv').config();
const { Sequelize } = require('sequelize');

function parseBoolean(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return null;
}

function resolveSslOption() {
    const explicitSsl = parseBoolean(process.env.DB_SSL);
    if (explicitSsl !== null) {
        return explicitSsl ? { require: true, rejectUnauthorized: false } : false;
    }

    const pgSslMode = (process.env.PGSSLMODE || '').toLowerCase();
    if (pgSslMode === 'disable') return false;
    if (['require', 'verify-ca', 'verify-full', 'allow', 'prefer', 'no-verify'].includes(pgSslMode)) {
        return { require: true, rejectUnauthorized: false };
    }

    return false;
}

const sslOption = resolveSslOption();

console.log('Testing connection with credentials from .env...');
console.log(`SSL mode: ${sslOption ? 'on' : 'off'}`);

const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASS || process.env.DB_PASSWORD,
    {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 5432,
        dialect: 'postgres',
        dialectOptions: sslOption ? { ssl: sslOption } : {}
    }
);

async function run() {
    try {
        console.log('Attempting to authenticate...');
        await sequelize.authenticate();
        console.log('SUCCESS: Connection has been established successfully.');

        console.log('Attempting to sync models...');
        await sequelize.sync({ force: false });
        console.log('SUCCESS: Models synchronized.');

        process.exit(0);
    } catch (error) {
        console.error('FAILURE:', error.name, error.message);
        if (error.original) {
            console.error('Original error:', error.original.message);
        }
        process.exit(1);
    }
}

run();
