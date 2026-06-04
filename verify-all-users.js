const { User } = require('./models');
const sequelize = require('./config/db');

async function verifyAll() {
    try {
        await sequelize.authenticate();
        console.log('Connected.');
        const result = await User.update({ isVerified: true }, { where: {} });
        console.log(`Updated ${result[0]} users to verified.`);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

verifyAll();
