const express = require('express');
const router = express.Router();
const { Budget, Category } = require('../models');

const isAuth = (req, res, next) => req.isAuthenticated() ? next() : res.redirect('/auth/login');

router.get('/', isAuth, async (req, res) => {
    const budgets = await Budget.findAll({ where: { userId: req.user.id }, include: [Category] });
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
    res.render('budgets/index', { title: 'Budgets', budgets, categories });
});

router.post('/add', isAuth, async (req, res) => {
    const { categoryId, amount, description } = req.body;
    let budget = await Budget.findOne({ where: { userId: req.user.id, categoryId } });
    if (budget) {
        budget.amount = amount;
        budget.description = description;
        await budget.save();
    }
    else { await Budget.create({ userId: req.user.id, categoryId, amount, description }); }
    res.redirect('/budgets');
});

router.put('/update', isAuth, async (req, res) => {
    const { id, categoryId, amount, description } = req.body;
    await Budget.update({
        categoryId,
        amount: parseFloat(amount),
        description
    }, {
        where: { id, userId: req.user.id }
    });
    res.redirect('/budgets');
});

router.delete('/:id', isAuth, async (req, res) => {
    await Budget.destroy({ where: { id: req.params.id, userId: req.user.id } });
    res.redirect('/budgets');
});

module.exports = router;
