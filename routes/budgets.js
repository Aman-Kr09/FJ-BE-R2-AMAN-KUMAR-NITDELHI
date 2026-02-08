const express = require('express');
const router = express.Router();
const { Budget, Category } = require('../models');
const { convert } = require('../services/currencyService');

const isAuth = (req, res, next) => req.isAuthenticated() ? next() : res.redirect('/auth/login');

router.get('/', isAuth, async (req, res) => {
    const userCurrency = req.user.currency || 'USD';
    const budgets = await Budget.findAll({ where: { userId: req.user.id }, include: [Category] });

    // Parallelize currency conversion for display
    const processedBudgets = await Promise.all(budgets.map(async (b) => {
        const convertedAmount = await convert(parseFloat(b.amount), 'USD', userCurrency);
        return {
            ...b.toJSON(),
            convertedAmount,
            Category: b.Category
        };
    }));

    const categories = await Category.findAll({
        where: {
            [require('sequelize').Op.and]: [
                { type: 'expense' },
                {
                    [require('sequelize').Op.or]: [
                        { userId: req.user.id },
                        { userId: null }
                    ]
                }
            ]
        }
    });

    res.render('budgets/index', {
        title: 'Budgets',
        budgets: processedBudgets,
        categories,
        userCurrency
    });
});

router.post('/add', isAuth, async (req, res) => {
    try {
        const { categoryId, amount, description } = req.body;
        const userCurrency = req.user.currency || 'USD';

        // Convert input amount (in user's currency) back to USD for base storage
        const amountInUsd = await convert(parseFloat(amount), userCurrency, 'USD');

        let budget = await Budget.findOne({ where: { userId: req.user.id, categoryId } });
        if (budget) {
            budget.amount = amountInUsd;
            budget.description = description;
            await budget.save();
        } else {
            await Budget.create({
                userId: req.user.id,
                categoryId,
                amount: amountInUsd,
                description
            });
        }
        res.redirect('/budgets');
    } catch (err) {
        console.error(err);
        res.redirect('/budgets');
    }
});

router.put('/update', isAuth, async (req, res) => {
    try {
        const { id, categoryId, amount, description } = req.body;
        const userCurrency = req.user.currency || 'USD';
        const amountInUsd = await convert(parseFloat(amount), userCurrency, 'USD');

        await Budget.update({
            categoryId,
            amount: amountInUsd,
            description
        }, {
            where: { id, userId: req.user.id }
        });
        res.redirect('/budgets');
    } catch (err) {
        console.error(err);
        res.redirect('/budgets');
    }
});

router.delete('/:id', isAuth, async (req, res) => {
    await Budget.destroy({ where: { id: req.params.id, userId: req.user.id } });
    res.redirect('/budgets');
});

module.exports = router;
