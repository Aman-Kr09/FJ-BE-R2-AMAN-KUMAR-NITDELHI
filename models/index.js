const User = require('./User');
const Category = require('./Category');
const Transaction = require('./Transaction');
const Budget = require('./Budget');
const Saving = require('./Saving');
const SavingPlan = require('./SavingPlan');

User.hasMany(Transaction, { foreignKey: 'userId', onDelete: 'CASCADE' });
Transaction.belongsTo(User, { foreignKey: 'userId' });

User.hasMany(Category, { foreignKey: 'userId', onDelete: 'CASCADE' });
Category.belongsTo(User, { foreignKey: 'userId' });

Category.hasMany(Transaction, { foreignKey: 'categoryId', onDelete: 'SET NULL' });
Transaction.belongsTo(Category, { foreignKey: 'categoryId' });

User.hasMany(Budget, { foreignKey: 'userId', onDelete: 'CASCADE' });
Budget.belongsTo(User, { foreignKey: 'userId' });

Category.hasMany(Budget, { foreignKey: 'categoryId', onDelete: 'CASCADE' });
Budget.belongsTo(Category, { foreignKey: 'categoryId' });

User.hasMany(Saving, { foreignKey: 'userId', onDelete: 'CASCADE' });
Saving.belongsTo(User, { foreignKey: 'userId' });

User.hasMany(SavingPlan, { foreignKey: 'userId', onDelete: 'CASCADE' });
SavingPlan.belongsTo(User, { foreignKey: 'userId' });

module.exports = { User, Category, Transaction, Budget, Saving, SavingPlan };
