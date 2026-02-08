const express = require('express');
const router = express.Router();
const passport = require('passport');
const bcrypt = require('bcryptjs');
const { User, Category } = require('../models');

router.get('/login', (req, res) => res.render('login', { title: 'Login' }));
router.get('/register', (req, res) => res.render('register', { title: 'Register' }));

router.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        let user = await User.findOne({ where: { email } });
        if (user) return res.render('register', { error: 'Email already registered' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await User.create({ name, email, password: hashedPassword });

        const defaultCategories = [
            { name: 'Food', type: 'expense' }, { name: 'Rent', type: 'expense' },
            { name: 'Salary', type: 'income' }, { name: 'Investment', type: 'income' },
            { name: 'Shopping', type: 'expense' }, { name: 'Health', type: 'expense' }
        ];
        await Category.bulkCreate(defaultCategories.map(c => ({ ...c, userId: newUser.id })));
        res.redirect('/auth/login');
    } catch (err) {
        res.render('register', { error: 'Something went wrong' });
    }
});

router.post('/login', passport.authenticate('local', {
    successRedirect: '/dashboard',
    failureRedirect: '/auth/login'
}));

router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/google/callback', passport.authenticate('google', {
    successRedirect: '/dashboard',
    failureRedirect: '/auth/login'
}));

router.get('/logout', (req, res) => {
    req.logout((err) => res.redirect('/'));
});

module.exports = router;
