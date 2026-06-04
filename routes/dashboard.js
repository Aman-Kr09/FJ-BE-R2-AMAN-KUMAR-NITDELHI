const express = require('express');
const router = express.Router();
const { Transaction, Category, Budget, Saving } = require('../models');
const { convert } = require('../services/currencyService');

const isAuth = (req, res, next) => req.isAuthenticated() ? next() : res.redirect('/auth/login');

router.get('/', isAuth, async (req, res) => {
    try {
        const userCurrency = req.user.currency || 'USD';

        // Current month bounds
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        const allTransactions = await Transaction.findAll({
            where: { userId: req.user.id },
            include: [Category],
            order: [['date', 'DESC']]
        });

        // Parallelize currency conversion for ALL transactions (for Recent Transactions list)
        const allConverted = await Promise.all(allTransactions.map(async (t) => {
            const amtInUserCurrency = await convert(parseFloat(t.amount), t.currency || 'USD', userCurrency);
            return { ...t.toJSON(), amtInUserCurrency, Category: t.Category };
        }));

        // Filter for current month stats and budget progress
        const monthlyTransactions = allConverted.filter(t => {
            const tDate = new Date(t.date);
            return tDate >= startOfMonth && tDate <= endOfMonth;
        });

        let totalIncome = 0;
        let totalExpense = 0;
        const categoryData = {};
        const incomeCategoryData = {};

        for (const t of monthlyTransactions) {
            const name = t.Category ? t.Category.name : 'Other';
            if (t.type === 'income') {
                totalIncome += t.amtInUserCurrency;
                incomeCategoryData[name] = (incomeCategoryData[name] || 0) + t.amtInUserCurrency;
            } else {
                totalExpense += t.amtInUserCurrency;
                categoryData[name] = (categoryData[name] || 0) + t.amtInUserCurrency;
            }
        }

        const budgets = await Budget.findAll({ where: { userId: req.user.id }, include: [Category] });

        // Parallelize budget progress calculations
        const budgetProgress = await Promise.all(budgets.map(async (b) => {
            const categoryTransactions = monthlyTransactions.filter(t => t.categoryId === b.categoryId);

            // Net spent = Expenses - Incomes (Refunds/Vouchers)
            const spent = categoryTransactions.reduce((acc, t) => {
                return t.type === 'expense' ? acc + t.amtInUserCurrency : acc - t.amtInUserCurrency;
            }, 0);

            // Convert budget limit (stored in USD) to user currency
            const limitInUserCurrency = await convert(parseFloat(b.amount), 'USD', userCurrency);

            return {
                category: b.Category.name,
                limit: limitInUserCurrency,
                spent,
                percent: limitInUserCurrency > 0 ? Math.min((spent / limitInUserCurrency) * 100, 100) : 0
            };
        }));

        const rawBalance = totalIncome - totalExpense;
        const savings = Math.max(0, rawBalance);
        const monthlyDeficit = rawBalance < 0 ? Math.abs(rawBalance) : 0;

        const savingsData = await Saving.findAll({ where: { userId: req.user.id } });

        // Parallelize savings conversion
        const convertedSavings = await Promise.all(savingsData.map(async (s) => {
            return await convert(parseFloat(s.amount), 'USD', userCurrency);
        }));

        let totalSavingsCompiled = convertedSavings.reduce((acc, val) => acc + val, 0);

        // Apply deficit if any
        totalSavingsCompiled = Math.max(0, totalSavingsCompiled - monthlyDeficit);

        res.render('dashboard', {
            title: 'Dashboard',
            totalIncome,
            totalExpense,
            savings,
            totalSavingsCompiled,
            categoryData,
            incomeCategoryData,
            budgetProgress,
            recentTransactions: allConverted.slice(0, 5),
            userCurrency
        });
    } catch (err) {
        console.error('Dashboard Error:', err);
        res.status(500).send('Internal Server Error');
    }
});

module.exports = router;
