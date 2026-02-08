const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Saving = sequelize.define('Saving', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    source: {
        type: DataTypes.STRING,
        allowNull: false
    },
    amount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0
    },
    description: {
        type: DataTypes.TEXT
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    isPrimary: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
});

module.exports = Saving;
