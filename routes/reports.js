const express = require('express');
const router = express.Router();
const { Transaction, Category } = require('../models');
const { Op } = require('sequelize');

const isAuth = (req, res, next) => req.isAuthenticated() ? next() : res.redirect('/auth/login');

router.get('/', isAuth, async (req, res) => {
    try {
        const { year } = req.query;
        const currentYear = parseInt(year) || new Date().getFullYear();

        // 1. Fetch current year transactions for category breakdown
        const transactions = await Transaction.findAll({
            where: {
                userId: req.user.id,
                date: {
                    [Op.between]: [`${currentYear}-01-01`, `${currentYear}-12-31`]
                }
            },
            include: [Category]
        });

        let totalIncome = 0, totalExpense = 0;
        const expenseCategories = {};
        const incomeCategories = {};

        transactions.forEach(t => {
            const amt = parseFloat(t.amount);
            const catName = t.Category ? t.Category.name : 'Uncategorized';
            if (t.type === 'income') {
                totalIncome += amt;
                incomeCategories[catName] = (incomeCategories[catName] || 0) + amt;
            } else {
                totalExpense += amt;
                expenseCategories[catName] = (expenseCategories[catName] || 0) + amt;
            }
        });

        // 2. Fetch monthly trend for the last 6 months
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
        sixMonthsAgo.setDate(1);

        const trendTransactions = await Transaction.findAll({
            where: {
                userId: req.user.id,
                date: { [Op.gte]: sixMonthsAgo }
            }
        });

        const months = [];
        const monthIncome = [];
        const monthExpense = [];

        for (let i = 5; i >= 0; i--) {
            const d = new Date();
            d.setMonth(d.getMonth() - i);
            const m = d.toLocaleString('default', { month: 'short' });
            const yearMonth = d.toISOString().slice(0, 7); // YYYY-MM

            months.push(m);
            const monthly = trendTransactions.filter(t => t.date.slice(0, 7) === yearMonth);
            monthIncome.push(monthly.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0));
            monthExpense.push(monthly.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0));
        }

        res.render('reports/index', {
            title: 'Financial Reports',
            totalIncome,
            totalExpense,
            incomeCategories,
            expenseCategories,
            months,
            monthIncome,
            monthExpense,
            currentYear
        });
    } catch (err) {
        console.error(err);
        res.redirect('/dashboard');
    }
});

module.exports = router;
