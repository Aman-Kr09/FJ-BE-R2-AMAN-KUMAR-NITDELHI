const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Budget = sequelize.define('Budget', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    amount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false
    },
    period: {
        type: DataTypes.STRING,
        defaultValue: 'monthly'
    },
    description: {
        type: DataTypes.TEXT
    }
});

module.exports = Budget;
