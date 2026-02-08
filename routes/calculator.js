const express = require('express');
const router = express.Router();
const { getRates } = require('../services/currencyService');

const isAuth = (req, res, next) => req.isAuthenticated() ? next() : res.redirect('/auth/login');

router.get('/', isAuth, async (req, res) => {
    try {
        const rates = await getRates();
        res.render('calculator', {
            title: 'Currency Calculator',
            rates: JSON.stringify(rates),
            currencies: Object.keys(rates).sort()
        });
    } catch (err) {
        console.error(err);
        res.redirect('/dashboard');
    }
});

module.exports = router;
