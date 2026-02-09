const { Transaction, Category } = require('../models');
const { Op } = require('sequelize');

const getAnomalies = async (userId) => {
    // 1. Fetch last 6 months of transactions for a robust baseline
    const transactions = await Transaction.findAll({
        where: { userId, type: 'expense', isAnomalyDismissed: false },
        include: [Category],
        order: [['date', 'DESC']]
    });

    if (transactions.length < 5) return []; // Not enough data for statistical significance

    const anomalies = [];
    const categoryGroups = {};

    // Group by category to find "Normal" per category
    transactions.forEach(t => {
        const catId = t.categoryId || 'uncategorized';
        if (!categoryGroups[catId]) categoryGroups[catId] = [];
        categoryGroups[catId].push(parseFloat(t.amount));
    });

    for (const t of transactions) {
        const catId = t.categoryId || 'uncategorized';
        const amounts = categoryGroups[catId];

        if (amounts.length >= 3) {
            // Calculate Mean and Standard Deviation
            const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
            const squareDiffs = amounts.map(a => Math.pow(a - mean, 2));
            const stdDev = Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / amounts.length);

            // Z-Score Detection: If transaction is > 2.5 StdDev from mean
            const zScore = stdDev === 0 ? 0 : (parseFloat(t.amount) - mean) / stdDev;

            if (zScore > 2.2) {
                anomalies.push({
                    transaction: t,
                    reason: `Unusual Spike: This is significantly higher than your typical ${t.Category?.name || 'uncategorized'} spending (Avg: $${mean.toFixed(2)})`,
                    severity: zScore > 4 ? 'high' : 'medium'
                });
                continue; // Move to next to avoid double flagging
            }
        }

        // Frequency Check: Multiple hits on same vendor in same day
        const sameDayFrequency = transactions.filter(other =>
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
