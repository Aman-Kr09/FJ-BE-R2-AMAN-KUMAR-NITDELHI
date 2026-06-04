require('dotenv').config();
const { Sequelize } = require('sequelize');

const dbHost = process.env.DB_HOST || 'localhost';
const dbPassword = process.env.DB_PASS || process.env.DB_PASSWORD;
const databaseUrl = process.env.DATABASE_URL;
const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);
const isCloud = dbHost.includes('neon.tech') || dbHost.includes('render.com') || Boolean(databaseUrl);

function parseBoolean(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function resolveSslOption() {
  // Highest precedence: explicit DB_SSL toggle.
  const explicitSsl = parseBoolean(process.env.DB_SSL);
  if (explicitSsl !== null) {
    return explicitSsl ? { require: true, rejectUnauthorized: false } : false;
  }

  // Next: standard libpq mode if provided.
  const pgSslMode = (process.env.PGSSLMODE || '').toLowerCase();
  if (pgSslMode === 'disable') return false;
  if (['require', 'verify-ca', 'verify-full', 'allow', 'prefer', 'no-verify'].includes(pgSslMode)) {
    return { require: true, rejectUnauthorized: false };
  }

  // Finally, infer from DATABASE_URL sslmode query only.
  if (databaseUrl) {
    try {
      const url = new URL(databaseUrl);
      const sslMode = (url.searchParams.get('sslmode') || '').toLowerCase();
      if (sslMode === 'disable') return false;
      if (['require', 'verify-ca', 'verify-full', 'allow', 'prefer', 'no-verify'].includes(sslMode)) {
        return { require: true, rejectUnauthorized: false };
      }
    } catch (error) {
      // Ignore URL parsing errors; fallback below.
    }
  }

  // Default to non-SSL unless explicitly requested.
  return false;
}

const sslOption = resolveSslOption();

const commonConfig = {
  dialect: 'postgres',
  logging: false,
  dialectOptions: sslOption ? { ssl: sslOption } : {},
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000
  },
  define: {
    timestamps: true
  }
};

let sequelize;

if (databaseUrl) {
  sequelize = new Sequelize(databaseUrl, commonConfig);
} else {
  if (isProduction) {
    const missing = [];
    if (!process.env.DB_HOST) missing.push('DB_HOST');
    if (!process.env.DB_NAME) missing.push('DB_NAME');
    if (!process.env.DB_USER) missing.push('DB_USER');
    if (!dbPassword) missing.push('DB_PASS or DB_PASSWORD');

    if (missing.length) {
      throw new Error(`Missing required database environment variables in production: ${missing.join(', ')}`);
    }
  }

  sequelize = new Sequelize(
    process.env.DB_NAME || 'finance_tracker',
    process.env.DB_USER || 'postgres',
    dbPassword || 'postgres',
    {
      host: dbHost,
      port: process.env.DB_PORT || 5432,
      ...commonConfig
    }
  );
}

console.log(`Connecting to ${isCloud ? 'Cloud' : 'Local'} DB at ${databaseUrl ? 'DATABASE_URL' : dbHost} (ssl=${sslOption ? 'on' : 'off'})...`);

module.exports = sequelize;
