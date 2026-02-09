const express = require('express');
const router = express.Router();
const passport = require('passport');
const bcrypt = require('bcryptjs');
const { User, Category } = require('../models');

router.get('/login', (req, res) => res.render('login', { title: 'Login' }));
router.get('/register', (req, res) => res.render('register', { title: 'Register' }));

// Update Google callback to auto-verify since Google already verified the email
router.get('/google/callback', passport.authenticate('google', { failureRedirect: '/auth/login' }), async (req, res) => {
    if (req.user) {
        await req.user.update({ isVerified: true });
        res.redirect('/dashboard');
    } else {
        res.redirect('/auth/login');
    }
});

const { sendOTP, sendVerificationEmail } = require('../services/emailService');
const { Op } = require('sequelize');

router.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        let user = await User.findOne({ where: { email } });
        if (user) return res.render('register', { title: 'Register', error: 'Email already registered' });

        const hashedPassword = await bcrypt.hash(password, 10);

        // Generate OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiry = new Date(Date.now() + 10 * 60 * 1000);

        const newUser = await User.create({
            name,
            email,
            password: hashedPassword,
            otpCode: otp,
            otpExpiry: expiry,
            isVerified: false
        });

        // Default categories (optional to move to after verification, but fine here)

        await sendVerificationEmail(email, otp);
        res.render('verify-registration', { title: 'Verify Email', email });
    } catch (err) {
        console.error(err);
        res.render('register', { title: 'Register', error: 'Something went wrong' });
    }
});

router.get('/verify-registration', (req, res) => {
    res.render('verify-registration', { title: 'Verify Email', email: req.query.email });
});

router.post('/verify-registration', async (req, res) => {
    const { email, otp } = req.body;
    try {
        const user = await User.findOne({
            where: {
                email,
                otpCode: otp,
                otpExpiry: { [Op.gt]: new Date() }
            }
        });

        if (!user) {
            return res.render('verify-registration', { title: 'Verify Email', email, error: 'Invalid or expired code' });
        }

        await user.update({ isVerified: true, otpCode: null, otpExpiry: null });

        // Add default categories after successful verification
        const defaultCategories = [
            { name: 'Food', type: 'expense' }, { name: 'Rent', type: 'expense' },
            { name: 'Salary', type: 'income' }, { name: 'Investment', type: 'income' },
            { name: 'Shopping', type: 'expense' }, { name: 'Health', type: 'expense' }
        ];
        await Category.bulkCreate(defaultCategories.map(c => ({ ...c, userId: user.id })));

        res.render('login', { title: 'Login', success: 'Email verified! You can now login.' });
    } catch (err) {
        res.render('verify-registration', { title: 'Verify Email', email, error: 'Something went wrong' });
    }
});

router.post('/login', passport.authenticate('local', {
    successRedirect: '/dashboard',
    failureRedirect: '/auth/login'
}));

router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/logout', (req, res) => {
    req.logout((err) => res.redirect('/'));
});

// Forgot Password Flow

router.get('/forgot-password', (req, res) => {
    res.render('forgot-password', { title: 'Forgot Password' });
});

router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ where: { email } });
        if (!user) {
            // We don't want to reveal if email exists, but for UX in a take-home we might
            return res.render('forgot-password', { title: 'Forgot Password', error: 'User not found' });
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

        await user.update({ otpCode: otp, otpExpiry: expiry });
        await sendOTP(email, otp);

        res.render('verify-otp', { title: 'Verify OTP', email });
    } catch (err) {
        console.error(err);
        res.render('forgot-password', { title: 'Forgot Password', error: 'Failed to send OTP' });
    }
});

router.post('/verify-otp', async (req, res) => {
    const { email, otp } = req.body;
    try {
        const user = await User.findOne({
            where: {
                email,
                otpCode: otp,
                otpExpiry: { [Op.gt]: new Date() }
            }
        });

        if (!user) {
            return res.render('verify-otp', { title: 'Verify OTP', email, error: 'Invalid or expired OTP' });
        }

        res.render('reset-password', { title: 'Reset Password', email, otp });
    } catch (err) {
        res.render('verify-otp', { title: 'Verify OTP', email, error: 'Something went wrong' });
    }
});

router.post('/reset-password', async (req, res) => {
    const { email, otp, password, confirmPassword } = req.body;
    if (password !== confirmPassword) {
        return res.render('reset-password', { title: 'Reset Password', email, otp, error: 'Passwords do not match' });
    }

    try {
        const user = await User.findOne({
            where: {
                email,
                otpCode: otp,
                otpExpiry: { [Op.gt]: new Date() }
            }
        });

        if (!user) return res.redirect('/auth/forgot-password');

        const hashedPassword = await bcrypt.hash(password, 10);
        await user.update({
            password: hashedPassword,
            otpCode: null,
            otpExpiry: null
        });

        res.render('login', { title: 'Login', success: 'Password reset successful. Please login.' });
    } catch (err) {
        res.render('reset-password', { title: 'Reset Password', email, otp, error: 'Failed to reset password' });
    }
});

module.exports = router;
