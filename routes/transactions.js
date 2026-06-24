const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { Transaction, Category, Budget } = require('../models');
const { convert } = require('../services/currencyService');
const { sendTransactionBudgetUpdate } = require('../services/emailService');
const { parseCSV, parsePDF, parsePDFWithAI, parsePDFWithRegex, detectDuplicates, autoCategorize } = require('../services/importService');

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
        const transactions = await Transaction.find({ userId: req.user.id })
            .populate('categoryId')
            .sort({ date: -1 });

        const displayTransactions = await Promise.all(transactions.map(async (t) => {
            const convertedAmount = await convert(parseFloat(t.amount), t.currency || 'USD', userCurrency);
            return {
                ...t.toObject(),
                convertedAmount,
                Category: t.categoryId
            };
        }));

        const categories = await Category.find({ userId: req.user.id });
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
            categoryId: categoryId || null,
            userId: req.user.id
        });

        const budget = await Budget.findOne({ userId: req.user.id, categoryId: categoryId || null });
        if (budget && categoryId) {
            const now = new Date(date);
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
            const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

            const monthlyCategoryTransactions = await Transaction.find({
                userId: req.user.id,
                categoryId,
                date: { $gte: startOfMonth, $lte: endOfMonth }
            });

            const convertedValues = await Promise.all(monthlyCategoryTransactions.map(async (t) => {
                const usdVal = await convert(parseFloat(t.amount), t.currency || 'USD', 'USD');
                return t.type === 'expense' ? usdVal : -usdVal;
            }));
            const totalSpentUsd = convertedValues.reduce((acc, val) => acc + val, 0);

            const category = await Category.findById(categoryId);
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
            categoryId: categoryId || null
        };

        if (req.file) {
            updateData.receiptUrl = `/uploads/${req.file.filename}`;
        }

        await Transaction.findOneAndUpdate({ _id: id, userId: req.user.id }, updateData);

        const budget = await Budget.findOne({ userId: req.user.id, categoryId: categoryId || null });
        if (budget && categoryId) {
            const now = new Date(date);
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
            const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

            const monthlyCategoryTransactions = await Transaction.find({
                userId: req.user.id,
                categoryId,
                date: { $gte: startOfMonth, $lte: endOfMonth }
            });

            const convertedValues = await Promise.all(monthlyCategoryTransactions.map(async (t) => {
                const usdVal = await convert(parseFloat(t.amount), t.currency || 'USD', 'USD');
                return t.type === 'expense' ? usdVal : -usdVal;
            }));
            const totalSpentUsd = convertedValues.reduce((acc, val) => acc + val, 0);

            const category = await Category.findById(categoryId);
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
        await Transaction.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
        res.redirect('/transactions');
    } catch (err) {
        console.error(err);
        res.status(500).send('Internal Server Error');
    }
});

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
        const userCurrency = req.user.currency || 'USD';
        let pTransactions = [];

        const originalNameLower = req.file.originalname.toLowerCase();

        if (req.file.mimetype === 'text/csv' || originalNameLower.endsWith('.csv')) {
            // parseCSV now handles ALL column detection, date normalisation, and type inference internally
            pTransactions = await parseCSV(filePath, userCurrency);
            console.log(`[Import] CSV parsed: ${pTransactions.length} transactions extracted`);

        } else if (req.file.mimetype === 'application/pdf' || originalNameLower.endsWith('.pdf')) {
            const pdfText = await parsePDF(filePath);
            console.log(`[Import] PDF text length: ${pdfText.length} chars`);

            const apiKey = (process.env.XAI_API_KEY || '').trim();
            if (apiKey && apiKey !== 'your_grok_xai_api_key_here') {
                try {
                    pTransactions = await parsePDFWithAI(pdfText, userCurrency);
                    console.log(`[Import] AI extracted ${pTransactions.length} transactions`);
                } catch (aiErr) {
                    console.warn('[Import] AI parsing failed, falling back to regex:', aiErr.message);
                    pTransactions = parsePDFWithRegex(pdfText, userCurrency);
                }
            } else {
                pTransactions = parsePDFWithRegex(pdfText, userCurrency);
            }
            console.log(`[Import] PDF parsed: ${pTransactions.length} transactions extracted`);
        }

        if (pTransactions.length === 0) {
            req.flash('error', 'No transactions found in the file. Make sure it is a valid bank statement.');
            return res.redirect('/transactions/import');
        }

        const categorized = await autoCategorize(req.user.id, pTransactions);
        const { uniqueTransactions, identifiedDuplicates } = await detectDuplicates(req.user.id, categorized);

        res.render('transactions/import-preview', {
            title: 'Review Import',
            transactions: uniqueTransactions,
            duplicates: identifiedDuplicates,
            categories: await Category.find({ userId: req.user.id })
        });
    } catch (err) {
        console.error('[Import Error]', err);
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
