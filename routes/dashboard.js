const express = require('express');
const router = express.Router();
const { Transaction, Category, Budget, Saving } = require('../models');
const { convert } = require('../services/currencyService');

const isAuth = (req, res, next) => req.isAuthenticated() ? next() : res.redirect('/auth/login');

router.get('/', isAuth, async (req, res) => {
    try {
        const userCurrency = req.user.currency || 'USD';
        const transactions = await Transaction.findAll({ where: { userId: req.user.id }, include: [Category] });

        let totalIncome = 0;
        let totalExpense = 0;
        const categoryData = {};
        const incomeCategoryData = {};

        for (const t of transactions) {
            const amtInUserCurrency = await convert(parseFloat(t.amount), t.currency || 'USD', userCurrency);
            const name = t.Category ? t.Category.name : 'Other';

            if (t.type === 'income') {
                totalIncome += amtInUserCurrency;
                incomeCategoryData[name] = (incomeCategoryData[name] || 0) + amtInUserCurrency;
            } else {
                totalExpense += amtInUserCurrency;
                categoryData[name] = (categoryData[name] || 0) + amtInUserCurrency;
            }
        }

        const budgets = await Budget.findAll({ where: { userId: req.user.id }, include: [Category] });
        const budgetProgress = [];
        for (const b of budgets) {
            const spentInBase = transactions
                .filter(t => t.type === 'expense' && t.categoryId === b.categoryId)
                .reduce((s, t) => s + parseFloat(t.amount), 0);

            // Assume budget amount property 'amount' is set in user's preferred currency or USD.
            // For now, treat budget amount as absolute in whatever currency user has.
            const spent = await convert(spentInBase, 'USD', userCurrency);
            budgetProgress.push({
                category: b.Category.name,
                limit: parseFloat(b.amount),
                spent: spent,
                percent: Math.min((spent / parseFloat(b.amount)) * 100, 100)
            });
        }

        const monthlySavings = Math.max(0, totalIncome - totalExpense);
        const monthlyDeficit = totalIncome < totalExpense ? (totalExpense - totalIncome) : 0;

        const savingsData = await Saving.findAll({ where: { userId: req.user.id } });
        let totalSavingsCompiled = 0;
        for (const s of savingsData) {
            totalSavingsCompiled += await convert(parseFloat(s.amount), 'USD', userCurrency);
        }

        totalSavingsCompiled = Math.max(0, totalSavingsCompiled - monthlyDeficit);

        res.render('dashboard', {
            title: 'Dashboard',
            totalIncome,
            totalExpense,
            savings: monthlySavings,
            totalSavingsCompiled,
            categoryData,
            incomeCategoryData,
            budgetProgress,
            recentTransactions: transactions.slice(0, 5),
            userCurrency
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Internal Server Error');
    }
});

module.exports = router;
