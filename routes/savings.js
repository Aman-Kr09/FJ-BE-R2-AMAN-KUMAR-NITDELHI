const express = require('express');
const router = express.Router();
const { Saving, SavingPlan, Transaction } = require('../models');

const isAuth = (req, res, next) => req.isAuthenticated() ? next() : res.redirect('/auth/login');

// Get Savings Page
router.get('/', isAuth, async (req, res) => {
    try {
        const savings = await Saving.findAll({ where: { userId: req.user.id } });
        const plans = await SavingPlan.findAll({ where: { userId: req.user.id } });

        // Calculate monthly deficit
        const transactions = await Transaction.findAll({ where: { userId: req.user.id } });
        const income = transactions.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0);
        const expense = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0);
        const deficit = expense > income ? expense - income : 0;

        // Process savings list to "cut" from primary bank if there's a deficit
        const processedSavings = savings.map(s => {
            let amount = parseFloat(s.amount);
            if (s.isPrimary && deficit > 0) {
                amount = Math.max(0, amount - deficit);
            }
            return { ...s.toJSON(), amount };
        });

        const rawTotal = processedSavings.reduce((acc, curr) => acc + curr.amount, 0);
        const totalSavings = rawTotal; // Deficit already deducted from primary

        res.render('savings/index', {
            title: 'Savings & Investments',
            savings: processedSavings,
            plans,
            totalSavings,
            rawTotal,
            monthlyDeficit: deficit
        });
    } catch (err) {
        console.error(err);
        res.redirect('/dashboard');
    }
});

// Add Saving Source (FD, Shares, etc)
router.post('/add', isAuth, async (req, res) => {
    try {
        const { source, amount, description, isPrimary } = req.body;
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount)) throw new Error('Invalid amount');

        // If this is set as primary, unset other primaries for this user
        if (isPrimary === 'true') {
            await Saving.update({ isPrimary: false }, { where: { userId: req.user.id } });
        }

        await Saving.create({
            source,
            amount: parsedAmount,
            description,
            isPrimary: isPrimary === 'true',
            userId: req.user.id
        });
        res.redirect('/savings');
    } catch (err) {
        console.error(err);
        res.redirect('/savings');
    }
});

// Set Primary Saving Source
router.post('/set-primary/:id', isAuth, async (req, res) => {
    try {
        await Saving.update({ isPrimary: false }, { where: { userId: req.user.id } });
        await Saving.update({ isPrimary: true }, { where: { id: req.params.id, userId: req.user.id } });
        res.redirect('/savings');
    } catch (err) {
        console.error(err);
        res.redirect('/savings');
    }
});

// Add Monthly Saving Plan
router.post('/plan/add', isAuth, async (req, res) => {
    try {
        const { goalName, targetAmount, month } = req.body;
        const parsedAmount = parseFloat(targetAmount);
        if (isNaN(parsedAmount)) throw new Error('Invalid target amount');

        await SavingPlan.create({
            goalName,
            targetAmount: parsedAmount,
            month,
            userId: req.user.id
        });
        res.redirect('/savings');
    } catch (err) {
        console.error(err);
        res.redirect('/savings');
    }
});

// Toggle Plan Completion
router.post('/plan/toggle/:id', isAuth, async (req, res) => {
    try {
        const plan = await SavingPlan.findOne({ where: { id: req.params.id, userId: req.user.id } });
        if (plan) {
            plan.isCompleted = !plan.isCompleted;
            await plan.save();
        }
        res.redirect('/savings');
    } catch (err) {
        console.error(err);
        res.redirect('/savings');
    }
});

// Update Saving Source
router.put('/update', isAuth, async (req, res) => {
    try {
        const { id, source, amount, description, isPrimary } = req.body;
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount)) throw new Error('Invalid amount');

        if (isPrimary === 'true') {
            await Saving.update({ isPrimary: false }, { where: { userId: req.user.id } });
        }

        await Saving.update({
            source,
            amount: parsedAmount,
            description,
            isPrimary: isPrimary === 'true'
        }, { where: { id, userId: req.user.id } });

        res.redirect('/savings');
    } catch (err) {
        console.error(err);
        res.redirect('/savings');
    }
});

// Delete Saving Source
router.delete('/:id', isAuth, async (req, res) => {
    try {
        await Saving.destroy({ where: { id: req.params.id, userId: req.user.id } });
        res.redirect('/savings');
    } catch (err) {
        console.error(err);
        res.redirect('/savings');
    }
});

// Delete Saving Plan
router.delete('/plan/:id', isAuth, async (req, res) => {
    try {
        await SavingPlan.destroy({ where: { id: req.params.id, userId: req.user.id } });
        res.redirect('/savings');
    } catch (err) {
        console.error(err);
        res.redirect('/savings');
    }
});

module.exports = router;
