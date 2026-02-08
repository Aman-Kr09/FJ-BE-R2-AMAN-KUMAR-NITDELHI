const express = require('express');
const router = express.Router();
const { Transaction, Category, Budget } = require('../models');
const { Op } = require('sequelize');
const multer = require('multer');
const path = require('path');
const { convert } = require('../services/currencyService');
const { sendBudgetAlert, sendTransactionBudgetUpdate } = require('../services/emailService');

const isAuth = (req, res, next) => req.isAuthenticated() ? next() : res.redirect('/auth/login');

// File upload setup
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        cb(null, 'receipt-' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

router.get('/', isAuth, async (req, res) => {
    try {
        const userCurrency = req.user.currency || 'USD';
        const transactions = await Transaction.findAll({
            where: { userId: req.user.id },
            include: [Category],
            order: [['date', 'DESC']]
        });

        // Parallelize currency conversion for uniform display
        const displayTransactions = await Promise.all(transactions.map(async (t) => {
            const convertedAmount = await convert(parseFloat(t.amount), t.currency || 'USD', userCurrency);
            return {
                ...t.toJSON(),
                convertedAmount,
                Category: t.Category
            };
        }));

        const categories = await Category.findAll({ where: { userId: req.user.id } });
        res.render('transactions/index', {
            transactions: displayTransactions,
            categories,
            title: 'Transactions',
            userCurrency
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Internal Server Error');
    }
});

router.post('/add', isAuth, upload.single('receipt'), async (req, res) => {
    try {
        const { amount, type, date, description, categoryId, currency } = req.body;
        const receiptUrl = req.file ? `/uploads/${req.file.filename}` : null;

        await Transaction.create({
            amount: parseFloat(amount),
            currency: currency || 'USD',
            type,
            date,
            description,
            receiptUrl,
            categoryId,
            userId: req.user.id
        });

        // Budget Overrun Check (Only for Expenses)
        // Budget Tracking & Notifications (Runs if a budget exists for this category)
        const budget = await Budget.findOne({ where: { userId: req.user.id, categoryId } });
        if (budget) {
            const now = new Date(date);
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

            const monthlyCategoryTransactions = await Transaction.findAll({
                where: {
                    userId: req.user.id,
                    categoryId,
                    date: { [Op.between]: [startOfMonth.toISOString().split('T')[0], endOfMonth.toISOString().split('T')[0]] }
                }
            });

            // Calculate net spending in USD (Expenses - Incomes)
            const convertedValues = await Promise.all(monthlyCategoryTransactions.map(async (t) => {
                const usdVal = await convert(parseFloat(t.amount), t.currency || 'USD', 'USD');
                return t.type === 'expense' ? usdVal : -usdVal;
            }));
            const totalSpentUsd = convertedValues.reduce((acc, val) => acc + val, 0);

            const category = await Category.findByPk(categoryId);
            const userCurrency = req.user.currency || 'USD';

            // Convert values for display in email
            const limitInUserCurrency = await convert(parseFloat(budget.amount), 'USD', userCurrency);
            const spentInUserCurrency = await convert(totalSpentUsd, 'USD', userCurrency);
            const transAmtInUserCurrency = await convert(parseFloat(amount), currency || 'USD', userCurrency);

            // Send Real-time Budget Progress Email for every transaction
            await sendTransactionBudgetUpdate(
                req.user.email,
                category.name,
                { amount: transAmtInUserCurrency, type, description },
                limitInUserCurrency,
                spentInUserCurrency,
                userCurrency
            );
        }

        res.redirect('/transactions');
    } catch (err) {
        console.error(err);
        res.status(500).send('Internal Server Error');
    }
});

router.put('/update', isAuth, upload.single('receipt'), async (req, res) => {
    try {
        const { id, amount, type, date, description, categoryId, currency } = req.body;
        const updateData = {
            amount: parseFloat(amount),
            currency: currency || 'USD',
            type,
            date,
            description,
            categoryId
        };

        if (req.file) {
            updateData.receiptUrl = `/uploads/${req.file.filename}`;
        }

        await Transaction.update(updateData, {
            where: { id, userId: req.user.id }
        });

        // Budget Overrun Check (Only for Expenses)
        // Budget Tracking & Notifications (Runs if a budget exists for this category)
        const budget = await Budget.findOne({ where: { userId: req.user.id, categoryId } });
        if (budget) {
            const now = new Date(date);
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

            const monthlyCategoryTransactions = await Transaction.findAll({
                where: {
                    userId: req.user.id,
                    categoryId,
                    date: { [Op.between]: [startOfMonth.toISOString().split('T')[0], endOfMonth.toISOString().split('T')[0]] }
                }
            });

            // Calculate net spending in USD (Expenses - Incomes)
            const convertedValues = await Promise.all(monthlyCategoryTransactions.map(async (t) => {
                const usdVal = await convert(parseFloat(t.amount), t.currency || 'USD', 'USD');
                return t.type === 'expense' ? usdVal : -usdVal;
            }));
            const totalSpentUsd = convertedValues.reduce((acc, val) => acc + val, 0);

            const category = await Category.findByPk(categoryId);
            const userCurrency = req.user.currency || 'USD';

            // Convert values for display in email
            const limitInUserCurrency = await convert(parseFloat(budget.amount), 'USD', userCurrency);
            const spentInUserCurrency = await convert(totalSpentUsd, 'USD', userCurrency);
            const transAmtInUserCurrency = await convert(parseFloat(amount), currency || 'USD', userCurrency);

            // Send Real-time Budget Progress Email for every update
            await sendTransactionBudgetUpdate(
                req.user.email,
                category.name,
                { amount: transAmtInUserCurrency, type, description },
                limitInUserCurrency,
                spentInUserCurrency,
                userCurrency
            );
        }

        res.redirect('/transactions');
    } catch (err) {
        console.error(err);
        res.status(500).send('Internal Server Error');
    }
});

router.delete('/:id', isAuth, async (req, res) => {
    try {
        await Transaction.destroy({ where: { id: req.params.id, userId: req.user.id } });
        res.redirect('/transactions');
    } catch (err) {
        console.error(err);
        res.status(500).send('Internal Server Error');
    }
});

module.exports = router;
