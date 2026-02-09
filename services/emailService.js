const { Resend } = require('resend');
require('dotenv').config();

const resend = new Resend(process.env.RESEND_API_KEY);

// NOTE: Resend requires a verified domain to send from custom addresses.
// For testing, you can use 'onboarding@resend.dev'.
const FROM_EMAIL = 'FinanceTracker <onboarding@resend.dev>';

const sendBudgetAlert = async (userEmail, categoryName, budgetAmount, spentAmount) => {
    try {
        if (!process.env.RESEND_API_KEY) {
            console.error('RESEND_API_KEY is missing. Email skipped.');
            return false;
        }

        const { data, error } = await resend.emails.send({
            from: FROM_EMAIL,
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
        });

        if (error) {
            console.error('Resend Error:', error);
            return false;
        }

        console.log('Budget Alert Sent:', data.id);
        return true;
    } catch (error) {
        console.error('Error sending budget alert:', error);
        return false;
    }
};

const sendBudgetUpdate = async (userEmail, categoryName, newLimit, userCurrency) => {
    try {
        if (!process.env.RESEND_API_KEY) {
            console.error('RESEND_API_KEY is missing. Email skipped.');
            return false;
        }

        const { data, error } = await resend.emails.send({
            from: FROM_EMAIL,
            to: userEmail,
            subject: `✅ Budget Updated: ${categoryName}`,
            html: `
                <div style="font-family: 'Outfit', sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #0f172a; color: #f8fafc;">
                    <h2 style="color: #6366f1; text-align: center;">Budget Limit Updated</h2>
                    <p style="font-size: 1.1rem;">Hello,</p>
                    <p>Your budget for the category <strong>${categoryName}</strong> has been successfully updated.</p>
                    
                    <div style="background: #1e293b; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <p style="margin: 5px 0; font-size: 1.2rem; text-align: center;">
                            <strong>New Limit:</strong> 
                            <span style="color: #6366f1;">${userCurrency} ${newLimit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </p>
                    </div>
                    
                    <p style="text-align: center;">Manage all your budgets and track your spending goals on your dashboard.</p>
                    
                    <div style="text-align: center; margin-top: 30px;">
                        <a href="${process.env.BASE_URL || 'http://localhost:3000'}/budgets" style="background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">View All Budgets</a>
                    </div>
                    
                    <hr style="border: 0; border-top: 1px solid #334155; margin: 30px 0;">
                    <p style="font-size: 0.8rem; color: #94a3b8; text-align: center;">
                        This is a confirmation of a change made to your account.
                    </p>
                </div>
            `
        });

        if (error) {
            console.error('Resend Error:', error);
            return false;
        }

        console.log('Budget Update Notification Sent:', data.id);
        return true;
    } catch (error) {
        console.error('Error sending budget update notification:', error);
        return false;
    }
};

const sendTransactionBudgetUpdate = async (userEmail, categoryName, transactionDetail, budgetLimit, currentSpent, userCurrency) => {
    try {
        if (!process.env.RESEND_API_KEY) {
            console.error('RESEND_API_KEY is missing. Email skipped.');
            return false;
        }

        const percent = (currentSpent / budgetLimit) * 100;
        const statusColor = percent > 100 ? '#ef4444' : percent > 80 ? '#f59e0b' : '#10b981';

        const { data, error } = await resend.emails.send({
            from: FROM_EMAIL,
            to: userEmail,
            subject: `📊 Budget Update: ${categoryName}`,
            html: `
                <div style="font-family: 'Outfit', sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #0f172a; color: #f8fafc;">
                    <h2 style="color: #6366f1; text-align: center;">Transaction Recorded</h2>
                    <p style="font-size: 1.1rem;">A <strong>${transactionDetail.type}</strong> was recorded in category <strong>${categoryName}</strong>.</p>
                    
                    <div style="background: #1e293b; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <p style="margin: 5px 0;"><strong>Transaction:</strong> ${userCurrency} ${transactionDetail.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                        <p style="margin: 5px 0;"><strong>Description:</strong> ${transactionDetail.description || 'N/A'}</p>
                    </div>

                    <h3 style="margin-top: 25px;">Budget Progress</h3>
                    <div style="background: #334155; height: 12px; border-radius: 6px; overflow: hidden; margin: 10px 0;">
                        <div style="background: ${statusColor}; width: ${Math.min(percent, 100)}%; height: 100%;"></div>
                    </div>
                    
                    <div style="display: flex; justify-content: space-between; font-size: 0.9rem;">
                        <span>Spent: ${userCurrency} ${currentSpent.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        <span>Limit: ${userCurrency} ${budgetLimit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    
                    <p style="text-align: center; margin-top: 20px; font-weight: bold; color: ${statusColor};">
                        ${percent > 100 ? '⚠️ Budget Exceeded!' : `You have used ${percent.toFixed(1)}% of your budget.`}
                    </p>

                    <div style="text-align: center; margin-top: 30px;">
                        <a href="${process.env.BASE_URL || 'http://localhost:3000'}/dashboard" style="background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Go to Dashboard</a>
                    </div>
                    
                    <hr style="border: 0; border-top: 1px solid #334155; margin: 30px 0;">
                    <p style="font-size: 0.8rem; color: #94a3b8; text-align: center;">
                        This is an automated tracking message.
                    </p>
                </div>
            `
        });

        if (error) {
            console.error('Resend Error:', error);
            return false;
        }

        console.log('Transaction Budget Update Sent:', data.id);
        return true;
    } catch (error) {
        console.error('Error sending transaction budget update:', error);
        return false;
    }
};

const sendOTP = async (userEmail, otp) => {
    try {
        if (!process.env.RESEND_API_KEY) {
            console.error('RESEND_API_KEY is missing. Email skipped.');
            return false;
        }

        const { data, error } = await resend.emails.send({
            from: FROM_EMAIL,
            to: userEmail,
            subject: `🔐 Your Password Reset OTP`,
            html: `
                <div style="font-family: 'Outfit', sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #0f172a; color: #f8fafc;">
                    <h2 style="color: #6366f1; text-align: center;">Password Reset Request</h2>
                    <p style="font-size: 1.1rem;">Hello,</p>
                    <p>We received a request to reset your password for your <strong>FinanceTracker</strong> account.</p>
                    <p>Use the OTP code below to proceed with the password reset. This code is valid for 10 minutes.</p>
                    
                    <div style="background: #1e293b; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
                        <h1 style="margin: 0; font-size: 3rem; letter-spacing: 10px; color: #6366f1;">${otp}</h1>
                    </div>

                    <p>If you did not request this, please ignore this email or contact support if you have concerns.</p>
                    
                    <hr style="border: 0; border-top: 1px solid #334155; margin: 30px 0;">
                    <p style="font-size: 0.8rem; color: #94a3b8; text-align: center;">
                        This is an automated security message.
                    </p>
                </div>
            `
        });

        if (error) {
            console.error('Resend Error:', error);
            return false;
        }

        console.log('OTP Email Sent:', data.id);
        return true;
    } catch (error) {
        console.error('Error sending OTP:', error);
        return false;
    }
};

module.exports = { sendBudgetAlert, sendBudgetUpdate, sendTransactionBudgetUpdate, sendOTP };
