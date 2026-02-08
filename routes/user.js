const express = require('express');
const router = express.Router();
const { User } = require('../models');

const isAuth = (req, res, next) => req.isAuthenticated() ? next() : res.redirect('/auth/login');

router.post('/update-currency', isAuth, async (req, res) => {
    try {
        const { currency } = req.body;
        await User.update({ currency }, { where: { id: req.user.id } });
        res.redirect(req.get('Referrer') || '/dashboard');
    } catch (err) {
        console.error(err);
        res.redirect('/dashboard');
    }
});

module.exports = router;
