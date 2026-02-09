const { Transaction, Category } = require('../models');
const { Op } = require('sequelize');

const getAnomalies = async (userId) => {
    // 1. Fetch last 6 months of transactions for ALL data to build a baseline
    const allTransactions = await Transaction.findAll({
        where: { userId, type: 'expense' },
        include: [Category],
        order: [['date', 'DESC']]
    });

    if (allTransactions.length < 5) return []; // Not enough data for statistical significance

    const anomalies = [];
    const categoryGroups = {};

    // Group by category to find "Normal" using ALL history
    allTransactions.forEach(t => {
        const catId = t.categoryId || 'uncategorized';
        if (!categoryGroups[catId]) categoryGroups[catId] = [];
        categoryGroups[catId].push(parseFloat(t.amount));
    });

    // Only flag transactions that haven't been dismissed yet
    const targetTransactions = allTransactions.filter(t => t.isAnomalyDismissed === false);

    for (const t of targetTransactions) {
        const catId = t.categoryId || 'uncategorized';
        const amounts = categoryGroups[catId];

        if (amounts.length >= 3) {
            // Calculate Mean and Standard Deviation from ALL category history
            const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
            const squareDiffs = amounts.map(a => Math.pow(a - mean, 2));
            const stdDev = Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / amounts.length);

            const zScore = stdDev === 0 ? 0 : (parseFloat(t.amount) - mean) / stdDev;

            if (zScore > 2.2) {
                anomalies.push({
                    transaction: t,
                    reason: `Unusual Spike: This is significantly higher than your typical ${t.Category?.name || 'uncategorized'} spending (Avg: $${mean.toFixed(2)})`,
                    severity: zScore > 4 ? 'high' : 'medium'
                });
                continue;
            }
        }

        // Frequency Check: Compare against ALL transactions to find clusters
        const sameDayFrequency = allTransactions.filter(other =>
            other.date === t.date &&
            other.description.toLowerCase() === t.description.toLowerCase() &&
            other.id !== t.id
        );

        if (sameDayFrequency.length >= 2) {
            anomalies.push({
                transaction: t,
                reason: `Frequency Cluster: Multiple transactions at "${t.description}" on the same day.`,
                severity: 'medium'
            });
        }
    }

    // Return unique flagged transactions (sort by date)
    return anomalies.sort((a, b) => new Date(b.transaction.date) - new Date(a.transaction.date));
};

module.exports = { getAnomalies };
