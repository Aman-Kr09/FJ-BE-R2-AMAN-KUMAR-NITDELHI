const fs = require('fs');
const csv = require('csv-parser');
const pdf = require('pdf-parse');
const { Transaction, Category, sequelize } = require('../models');
const { Op } = require('sequelize');
const { getAIResponse } = require('./aiService');

const parseCSV = (filePath) => {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', (error) => reject(error));
    });
};

const parsePDF = async (filePath) => {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdf(dataBuffer);
    return data.text;
};

const detectDuplicates = async (userId, transactions) => {
    const identifiedDuplicates = [];
    const uniqueTransactions = [];

    for (const trans of transactions) {
        // Normalize date for comparison: convert to YYYY-MM-DD
        let normalizedDate = trans.date;
        try {
            const d = new Date(trans.date);
            if (!isNaN(d.getTime())) {
                normalizedDate = d.toISOString().split('T')[0];
            }
        } catch (e) { }

        // Duplicate Check: Same Date, Same Amount (2 dec), and Same Description (Case Insensitive)
        const existing = await Transaction.findOne({
            where: {
                userId,
                amount: parseFloat(trans.amount).toFixed(2),
                date: normalizedDate,
                description: { [Op.iLike]: trans.description.trim() }
            }
        });

        if (existing) {
            identifiedDuplicates.push(trans);
        } else {
            uniqueTransactions.push({ ...trans, date: normalizedDate });
        }
    }

    return { uniqueTransactions, identifiedDuplicates };
};

const autoCategorize = async (userId, transactions) => {
    const categories = await Category.findAll({ where: { userId } });
    const processedTransactions = [...transactions];

    for (let i = 0; i < processedTransactions.length; i++) {
        const trans = processedTransactions[i];

        // 1. Check if the CSV already has a category that matches our DB
        let found = null;
        if (trans.csvCategory) {
            found = categories.find(c =>
                c.name.toLowerCase() === trans.csvCategory.toLowerCase()
            );
        }

        // 2. Simple heuristic: check if any part of the description matches a category name
        if (!found) {
            found = categories.find(c =>
                trans.description.toLowerCase().includes(c.name.toLowerCase())
            );
        }

        // 3. Common keyword mapping (fallback)
        if (!found) {
            const keywordMap = {
                'amazon': 'Shopping',
                'walmart': 'Groceries',
                'target': 'Shopping',
                'starbucks': 'Food',
                'mcdonald': 'Food',
                'netflix': 'Entertainment',
                'spotify': 'Entertainment',
                'uber': 'Transport',
                'lyft': 'Transport',
                'salary': 'Salary',
                'payroll': 'Salary',
                'depo': 'Salary',
                'dividend': 'Salary',
                'rent': 'Housing',
                'apartment': 'Housing',
                'mortgage': 'Housing',
                'electric': 'Utilities',
                'water': 'Utilities',
                'internet': 'Utilities'
            };
            const keyword = Object.keys(keywordMap).find(k => trans.description.toLowerCase().includes(k));
            if (keyword) {
                found = categories.find(c => c.name.toLowerCase() === keywordMap[keyword].toLowerCase());
            }
        }

        if (found) {
            trans.categoryId = found.id;
        }
    }

    return processedTransactions;
};

module.exports = {
    parseCSV,
    parsePDF,
    detectDuplicates,
    autoCategorize
};
