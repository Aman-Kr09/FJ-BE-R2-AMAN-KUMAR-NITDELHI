const express = require('express');
const router = express.Router();
const { Transaction, Category } = require('../models');
const { Op } = require('sequelize');
const { convert } = require('../services/currencyService');

const isAuth = (req, res, next) => req.isAuthenticated() ? next() : res.redirect('/auth/login');

router.get('/', isAuth, async (req, res) => {
    try {
        const { year } = req.query;
        const currentYear = parseInt(year) || new Date().getFullYear();
        const userCurrency = req.user.currency || 'USD';

        // 1. Fetch current year transactions for category breakdown
        const transactions = await Transaction.findAll({
            where: {
                userId: req.user.id,
                date: {
                    [Op.and]: [
                        { [Op.gte]: `${currentYear}-01-01` },
                        { [Op.lte]: `${currentYear}-12-31` }
                    ]
                }
            },
            include: [Category]
        });

        let totalIncome = 0;
        let totalExpense = 0;
        // Parallelize conversions for year transactions
        const transactionEntries = await Promise.all(transactions.map(async (t) => {
            const amt = await convert(parseFloat(t.amount), t.currency || 'USD', userCurrency);
            return { ...t.toJSON(), amt, Category: t.Category };
        }));

        const expenseCategories = {};
        const incomeCategories = {};

        for (const t of transactionEntries) {
            const catName = t.Category ? t.Category.name : 'Uncategorized';
            if (t.type === 'income') {
                totalIncome += t.amt;
                incomeCategories[catName] = (incomeCategories[catName] || 0) + t.amt;
            } else {
                totalExpense += t.amt;
                expenseCategories[catName] = (expenseCategories[catName] || 0) + t.amt;
            }
        }

        // 2. Fetch monthly trend for the last 6 months
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
        sixMonthsAgo.setDate(1);

        const trendTransactions = await Transaction.findAll({
            where: {
                userId: req.user.id,
                date: { [Op.gte]: sixMonthsAgo.toISOString().split('T')[0] }
            }
        });

        const months = [];
        const monthIncome = [];
        const monthExpense = [];

        for (let i = 0; i < 6; i++) {
            const d = new Date();
            d.setMonth(d.getMonth() - (5 - i));
            const m = d.toLocaleString('default', { month: 'short' });
            const yearMonth = d.toISOString().slice(0, 7);

            months.push(m);
            const monthly = trendTransactions.filter(t => t.date.slice(0, 7) === yearMonth);

            let mi = 0, me = 0;
            for (const t of monthly) {
                const convertedAmt = await convert(parseFloat(t.amount), t.currency || 'USD', userCurrency);
                if (t.type === 'income') mi += convertedAmt;
                else me += convertedAmt;
            }
            monthIncome.push(mi);
            monthExpense.push(me);
        }

        res.render('reports/index', {
            title: 'Reports',
            totalIncome,
            totalExpense,
            expenseCategories,
            incomeCategories,
            months,
            monthIncome,
            monthExpense,
            currentYear,
            userCurrency
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Internal Server Error');
    }
});

module.exports = router;
