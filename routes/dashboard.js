const express = require('express');
const router = express.Router();
const { Transaction, Category, Budget, Saving } = require('../models');
const { convert } = require('../services/currencyService');

const isAuth = (req, res, next) => req.isAuthenticated() ? next() : res.redirect('/auth/login');

router.get('/', isAuth, async (req, res) => {
    const userCurrency = req.user.currency || 'USD';
    const transactions = await Transaction.findAll({ where: { userId: req.user.id }, include: [Category] });

    let income = 0, expense = 0;
    const categoryData = {};
    const incomeCategoryData = {};

    for (const t of transactions) {
        const amtRaw = parseFloat(t.amount);
        const amt = await convert(amtRaw, t.currency || 'USD', userCurrency);
        const name = t.Category ? t.Category.name : 'Other';

        if (t.type === 'income') {
            income += amt;
            incomeCategoryData[name] = (incomeCategoryData[name] || 0) + amt;
        } else {
            expense += amt;
            categoryData[name] = (categoryData[name] || 0) + amt;
        }
    }

    const budgets = await Budget.findAll({ where: { userId: req.user.id }, include: [Category] });
    const budgetProgress = [];
    for (const b of budgets) {
        const spentRaw = transactions
            .filter(t => t.type === 'expense' && t.categoryId === b.categoryId)
            .reduce((s, t) => s + parseFloat(t.amount), 0);

        // Note: Simplification: assuming budget amount is in user's preferred currency
        const spent = await convert(spentRaw, 'USD', userCurrency);
        budgetProgress.push({
            category: b.Category.name,
            limit: b.amount,
            spent,
            percent: Math.min((spent / b.amount) * 100, 100)
        });
    }

    const rawBalance = income - expense;
    const savings = Math.max(0, rawBalance);
    const monthlyDeficit = rawBalance < 0 ? Math.abs(rawBalance) : 0;

    const savingsData = await Saving.findAll({ where: { userId: req.user.id } });
    let totalSavingsCompiled = 0;
    for (const s of savingsData) {
        totalSavingsCompiled += await convert(parseFloat(s.amount), 'USD', userCurrency);
    }

    totalSavingsCompiled = Math.max(0, totalSavingsCompiled - monthlyDeficit);

    res.render('dashboard', {
        title: 'Dashboard',
        totalIncome: income,
        totalExpense: expense,
        savings,
        totalSavingsCompiled,
        categoryData,
        incomeCategoryData,
        budgetProgress,
        recentTransactions: transactions.slice(0, 5),
        userCurrency
    });
});

module.exports = router;
