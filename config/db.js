require('dotenv').config();
const { Sequelize } = require('sequelize');

const isCloud = process.env.DB_HOST && process.env.DB_HOST.includes('neon.tech');

const sequelize = new Sequelize(
  process.env.DB_NAME || 'finance_tracker',
  process.env.DB_USER || 'postgres',
  process.env.DB_PASS || 'postgres',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: false,
    dialectOptions: isCloud ? {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    } : {},
    define: {
      timestamps: true
    }
  }
);

console.log(`Connecting to ${isCloud ? 'Cloud' : 'Local'} DB at ${process.env.DB_HOST || 'localhost'}...`);

module.exports = sequelize;
