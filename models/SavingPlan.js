const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const SavingPlan = sequelize.define('SavingPlan', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    goalName: {
        type: DataTypes.STRING,
        allowNull: false
    },
    targetAmount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false
    },
    isCompleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    month: {
        type: DataTypes.STRING
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false
    }
});

module.exports = SavingPlan;
