const express = require('express');
const router = express.Router();
const { Transaction, Category, User, Budget } = require('../models');
const { sendBudgetAlert } = require('../services/emailService');
const { Op } = require('sequelize');
const multer = require('multer');
const path = require('path');

const isAuth = (req, res, next) => req.isAuthenticated() ? next() : res.redirect('/auth/login');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, './uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

router.get('/', isAuth, async (req, res) => {
    const transactions = await Transaction.findAll({ where: { userId: req.user.id }, include: [Category], order: [['date', 'DESC']] });
    const categories = await Category.findAll({
        where: {
            [Op.or]: [
                { userId: req.user.id },
                { userId: null }
            ]
        }
    });
    res.render('transactions/index', { title: 'Transactions', transactions, categories, currencies: ['USD', 'EUR', 'GBP', 'INR', 'JPY'] });
});

router.post('/add', isAuth, upload.single('receipt'), async (req, res) => {
    try {
        const { amount, type, date, description, categoryId, currency } = req.body;
        const parsedAmount = parseFloat(amount);

        // Create Transaction
        const transaction = await Transaction.create({
            amount: parsedAmount,
            type,
            date,
            description,
            categoryId,
            currency,
            userId: req.user.id,
            receiptUrl: req.file ? `/uploads/${req.file.filename}` : null
        });

        // Budget Overrun Check (Only for Expenses)
        if (type === 'expense' && categoryId) {
            const budget = await Budget.findOne({
                where: { categoryId, userId: req.user.id }
            });

            if (budget) {
                // Get all expenses for this category in the current month
                const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
                const currentMonthExpenses = await Transaction.findAll({
                    where: {
                        userId: req.user.id,
                        categoryId,
                        type: 'expense',
                        date: { [Op.gte]: startOfMonth.toISOString().split('T')[0] }
                    }
                });

                const totalSpent = currentMonthExpenses.reduce((sum, t) => sum + parseFloat(t.amount), 0);

                if (totalSpent > parseFloat(budget.amount)) {
                    const category = await Category.findByPk(categoryId);
                    // Send Email Alert
                    await sendBudgetAlert(
                        req.user.email,
                        category ? category.name : 'Unknown',
                        parseFloat(budget.amount),
                        totalSpent
                    );
                }
            }
        }

        res.redirect('/transactions');
    } catch (err) {
        console.error(err);
        res.redirect('/transactions');
    }
});

router.put('/update', isAuth, upload.single('receipt'), async (req, res) => {
    try {
        const { id, amount, type, date, description, categoryId, currency } = req.body;
        const updateData = {
            amount: parseFloat(amount),
            type,
            date,
            description,
            categoryId,
            currency
        };

        if (req.file) {
            updateData.receiptUrl = `/uploads/${req.file.filename}`;
        }

        await Transaction.update(updateData, {
            where: { id, userId: req.user.id }
        });
        res.redirect('/transactions');
    } catch (err) {
        console.error(err);
        res.redirect('/transactions');
    }
});

router.delete('/:id', isAuth, async (req, res) => {
    await Transaction.destroy({ where: { id: req.params.id, userId: req.user.id } });
    res.redirect('/transactions');
});

module.exports = router;
