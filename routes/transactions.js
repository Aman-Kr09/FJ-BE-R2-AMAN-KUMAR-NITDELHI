const express = require('express');
const router = express.Router();
const { Transaction, Category, Budget } = require('../models');
const { Op } = require('sequelize');
const multer = require('multer');
const path = require('path');
const { convert } = require('../services/currencyService');
const { sendBudgetAlert } = require('../services/emailService');

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
        if (type === 'expense' && categoryId) {
            const budget = await Budget.findOne({ where: { userId: req.user.id, categoryId } });
            if (budget) {
                const now = new Date(date);
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

                const currentMonthExpenses = await Transaction.findAll({
                    where: {
                        userId: req.user.id,
                        categoryId,
                        type: 'expense',
                        date: { [Op.between]: [startOfMonth.toISOString().split('T')[0], endOfMonth.toISOString().split('T')[0]] }
                    }
                });

                // Convert all category expenses to USD to compare with budget.amount (which is in USD)
                const convertedExpenses = await Promise.all(currentMonthExpenses.map(async (t) => {
                    return await convert(parseFloat(t.amount), t.currency || 'USD', 'USD');
                }));

                const totalSpentUsd = convertedExpenses.reduce((acc, val) => acc + val, 0);

                if (totalSpentUsd > parseFloat(budget.amount)) {
                    const category = await Category.findByPk(categoryId);
                    const userCurrency = req.user.currency || 'USD';

                    // Convert USD values to User Currency for display in the email
                    const limitInUserCurrency = await convert(parseFloat(budget.amount), 'USD', userCurrency);
                    const spentInUserCurrency = await convert(totalSpentUsd, 'USD', userCurrency);

                    console.log(`Alert: Budget exceeded for ${category.name}. Limit: ${limitInUserCurrency}, Spent: ${spentInUserCurrency}`);

                    // Send Email Alert
                    await sendBudgetAlert(
                        req.user.email,
                        category.name,
                        limitInUserCurrency,
                        spentInUserCurrency
                    );
                }
            }
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
        if (type === 'expense' && categoryId) {
            const budget = await Budget.findOne({ where: { userId: req.user.id, categoryId } });
            if (budget) {
                const now = new Date(date);
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

                const currentMonthExpenses = await Transaction.findAll({
                    where: {
                        userId: req.user.id,
                        categoryId,
                        type: 'expense',
                        date: { [Op.between]: [startOfMonth.toISOString().split('T')[0], endOfMonth.toISOString().split('T')[0]] }
                    }
                });

                const convertedExpenses = await Promise.all(currentMonthExpenses.map(async (t) => {
                    return await convert(parseFloat(t.amount), t.currency || 'USD', 'USD');
                }));
                const totalSpentUsd = convertedExpenses.reduce((acc, val) => acc + val, 0);

                if (totalSpentUsd > parseFloat(budget.amount)) {
                    const category = await Category.findByPk(categoryId);
                    const userCurrency = req.user.currency || 'USD';
                    const limitInUserCurrency = await convert(parseFloat(budget.amount), 'USD', userCurrency);
                    const spentInUserCurrency = await convert(totalSpentUsd, 'USD', userCurrency);

                    await sendBudgetAlert(req.user.email, category.name, limitInUserCurrency, spentInUserCurrency);
                }
            }
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
