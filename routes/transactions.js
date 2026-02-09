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

            const convertedValues = await Promise.all(monthlyCategoryTransactions.map(async (t) => {
                const usdVal = await convert(parseFloat(t.amount), t.currency || 'USD', 'USD');
                return t.type === 'expense' ? usdVal : -usdVal;
            }));
            const totalSpentUsd = convertedValues.reduce((acc, val) => acc + val, 0);

            const category = await Category.findByPk(categoryId);
            const userCurrency = req.user.currency || 'USD';
            const limitInUserCurrency = await convert(parseFloat(budget.amount), 'USD', userCurrency);
            const spentInUserCurrency = await convert(totalSpentUsd, 'USD', userCurrency);
            const transAmtInUserCurrency = await convert(parseFloat(amount), currency || 'USD', userCurrency);

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

            const convertedValues = await Promise.all(monthlyCategoryTransactions.map(async (t) => {
                const usdVal = await convert(parseFloat(t.amount), t.currency || 'USD', 'USD');
                return t.type === 'expense' ? usdVal : -usdVal;
            }));
            const totalSpentUsd = convertedValues.reduce((acc, val) => acc + val, 0);

            const category = await Category.findByPk(categoryId);
            const userCurrency = req.user.currency || 'USD';
            const limitInUserCurrency = await convert(parseFloat(budget.amount), 'USD', userCurrency);
            const spentInUserCurrency = await convert(totalSpentUsd, 'USD', userCurrency);
            const transAmtInUserCurrency = await convert(parseFloat(amount), currency || 'USD', userCurrency);

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

const { parseCSV, parsePDF, detectDuplicates, autoCategorize } = require('../services/importService');

router.get('/import', isAuth, (req, res) => {
    res.render('transactions/import', { title: 'Import Bank Statement' });
});

router.post('/import', isAuth, upload.single('statement'), async (req, res) => {
    try {
        if (!req.file) {
            req.flash('error', 'Please upload a CSV or PDF file.');
            return res.redirect('/transactions/import');
        }

        const filePath = req.file.path;
        let pTransactions = [];

        if (req.file.mimetype === 'text/csv' || req.file.originalname.endsWith('.csv')) {
            const raw = await parseCSV(filePath);
            pTransactions = raw.map(row => {
                const keys = Object.keys(row);

                // Flexible column detection logic - Stricter for short codes
                const findKey = (terms) => keys.find(k => {
                    const l = k.trim().toLowerCase();
                    return terms.some(t => {
                        if (t.length <= 2) return l === t || l.startsWith(t + ' ') || l.endsWith(' ' + t) || l.includes(' ' + t + ' ');
                        return l === t || (l.includes(t) && !l.includes('date') && !l.includes('category') && !l.includes('balance'));
                    });
                });

                const dateKey = findKey(['date', 'time']);
                const descKey = findKey(['desc', 'particulars', 'remarks', 'trans']);
                const catKey = findKey(['category', 'group', 'tag']);
                const debitKey = findKey(['debit', 'dr', 'withdrawal', 'paid out', 'spending', 'spent']);
                const creditKey = findKey(['credit', 'cr', 'deposit', 'paid in', 'income', 'earned']);
                const amtKey = findKey(['amount', 'value', 'total', 'amt']);

                let amount = 0;
                let type = 'expense';

                const parseAmtString = (val) => {
                    if (val === undefined || val === null || val === '') return 0;
                    // Remove currency symbols, commas, and handle negative signs
                    const clean = val.toString().replace(/[^0-9.-]/g, '');
                    return clean ? parseFloat(clean) : 0;
                };

                const dVal = debitKey ? parseAmtString(row[debitKey]) : 0;
                const cVal = creditKey ? parseAmtString(row[creditKey]) : 0;
                const aVal = amtKey ? parseAmtString(row[amtKey]) : 0;

                // Priority: Use non-zero value from Debit/Credit columns first
                if (dVal !== 0) {
                    amount = Math.abs(dVal);
                    type = dVal < 0 ? 'income' : 'expense';
                } else if (cVal !== 0) {
                    amount = Math.abs(cVal);
                    type = cVal < 0 ? 'expense' : 'income';
                } else if (aVal !== 0) {
                    amount = Math.abs(aVal);
                    type = aVal < 0 ? 'expense' : 'income';
                }

                let dateStr = row[dateKey] || new Date().toISOString().split('T')[0];
                if (dateStr.toString().includes('#')) dateStr = new Date().toISOString().split('T')[0];

                return {
                    date: dateStr,
                    description: (row[descKey] || 'Imported Transaction').trim(),
                    csvCategory: row[catKey] || '',
                    amount: amount,
                    type: type,
                    currency: req.user.currency || 'USD'
                };
            }).filter(t => t.amount !== 0); // Skip rows with zero amount (like Opening Balance headers)
        }

        if (pTransactions.length === 0) {
            req.flash('error', 'No transactions found in the file.');
            return res.redirect('/transactions/import');
        }

        const categorized = await autoCategorize(req.user.id, pTransactions);
        const { uniqueTransactions, identifiedDuplicates } = await detectDuplicates(req.user.id, categorized);

        res.render('transactions/import-preview', {
            title: 'Review Import',
            transactions: uniqueTransactions,
            duplicates: identifiedDuplicates,
            categories: await Category.findAll({ where: { userId: req.user.id } })
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Error processing file: ' + err.message);
        res.redirect('/transactions/import');
    }
});

router.post('/import/confirm', isAuth, async (req, res) => {
    try {
        let { transactions } = req.body;
        if (transactions && !Array.isArray(transactions)) {
            transactions = Object.values(transactions);
        }

        if (!transactions || transactions.length === 0) {
            req.flash('error', 'No transactions selected for import.');
            return res.redirect('/transactions/import');
        }

        const toImport = transactions.filter(t => t.active === 'true');

        if (toImport.length === 0) {
            req.flash('error', 'Please select at least one transaction to import.');
            return res.redirect('/transactions/import');
        }

        for (const trans of toImport) {
            await Transaction.create({
                amount: parseFloat(trans.amount),
                type: trans.type,
                date: trans.date,
                description: trans.description,
                categoryId: trans.categoryId && trans.categoryId !== '' ? trans.categoryId : null,
                currency: trans.currency || req.user.currency || 'USD',
                userId: req.user.id
            });
        }

        req.flash('success', `${toImport.length} transactions imported successfully!`);
        res.redirect('/transactions');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to save imported transactions.');
        res.redirect('/transactions/import');
    }
});

module.exports = router;
