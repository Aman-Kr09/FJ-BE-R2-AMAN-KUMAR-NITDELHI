require('dotenv').config();
const { Sequelize } = require('sequelize');

const dbHost = process.env.DB_HOST || 'localhost';
const dbPassword = process.env.DB_PASS || process.env.DB_PASSWORD;
const databaseUrl = process.env.DATABASE_URL;
const isCloud = dbHost.includes('neon.tech') || dbHost.includes('render.com') || Boolean(databaseUrl);
const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);

const commonConfig = {
  dialect: 'postgres',
  logging: false,
  dialectOptions: isCloud ? {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  } : {},
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

console.log(`Connecting to ${isCloud ? 'Cloud' : 'Local'} DB at ${databaseUrl ? 'DATABASE_URL' : dbHost}...`);

module.exports = sequelize;
