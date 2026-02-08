const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.NODEMAILER_EMAIL,
        pass: process.env.NODEMAILER_PASS
    }
});

const sendBudgetAlert = async (userEmail, categoryName, budgetAmount, spentAmount) => {
    try {
        const mailOptions = {
            from: `"FinanceTracker" <${process.env.NODEMAILER_EMAIL}>`,
            to: userEmail,
            subject: `⚠️ Budget Alert: ${categoryName} Limit Exceeded!`,
            html: `
                <div style="font-family: 'Outfit', sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #0f172a; color: #f8fafc;">
                    <h2 style="color: #ef4444; text-align: center;">Budget Exceeded!</h2>
                    <p style="font-size: 1.1rem;">Hello,</p>
                    <p>This is an automated alert from your <strong>FinanceTracker</strong>.</p>
                    <p>You have exceeded your monthly budget for the category: <strong>${categoryName}</strong>.</p>
                    
                    <div style="background: #1e293b; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <p style="margin: 5px 0;"><strong>Budget Limit:</strong> $${budgetAmount.toLocaleString()}</p>
                        <p style="margin: 5px 0; color: #ef4444;"><strong>Current Spending:</strong> $${spentAmount.toLocaleString()}</p>
                        <p style="margin: 5px 0; font-weight: bold; color: #f59e0b;">Overrun: $${(spentAmount - budgetAmount).toLocaleString()}</p>
                    </div>

                    <p>We recommend reviewing your recent transactions and adjusting your spending to stay on track with your financial goals.</p>
                    
                    <div style="text-align: center; margin-top: 30px;">
                        <a href="${process.env.BASE_URL || 'http://localhost:3000'}/budgets" style="background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Review Budgets</a>
                    </div>

                    <hr style="border: 0; border-top: 1px solid #334155; margin: 30px 0;">
                    <p style="font-size: 0.8rem; color: #94a3b8; text-align: center;">
                        This is an automated message. Please do not reply to this email.
                    </p>
                </div>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Budget Alert Sent:', info.messageId);
        return true;
    } catch (error) {
        console.error('Error sending budget alert:', error);
        return false;
    }
};

module.exports = { sendBudgetAlert };
