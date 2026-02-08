require('dotenv').config();
const { Sequelize } = require('sequelize');

console.log('Testing connection with credentials from .env...');

const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASS,
    {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 5432,
        dialect: 'postgres',
        dialectOptions: {
            ssl: {
                require: true,
                rejectUnauthorized: false
            }
        }
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
