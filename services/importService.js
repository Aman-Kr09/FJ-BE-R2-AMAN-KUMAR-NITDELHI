const fs = require('fs');
const csv = require('csv-parser');
const pdf = require('pdf-parse');
const axios = require('axios');
const { Transaction, Category } = require('../models');
const { getAIResponse } = require('./aiService');

const parseCSV = (filePath) => {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(csv({ mapHeaders: ({ header }) => header.trim().replace(/^\ufeff/, '') }))
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

        // Duplicate Check: Same Date, Same Amount, and Same Description (Case Insensitive)
        const existing = await Transaction.findOne({
            userId,
            amount: parseFloat(parseFloat(trans.amount).toFixed(2)),
            date: normalizedDate,
            description: { $regex: `^${trans.description.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
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
    const categories = await Category.find({ userId });
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
            trans.categoryId = found._id.toString();
        }
    }

    return processedTransactions;
};

const parsePDFWithAI = async (pdfText, userCurrency) => {
    try {
        const apiKey = process.env.XAI_API_KEY ? process.env.XAI_API_KEY.trim() : null;
        if (!apiKey || apiKey === 'your_grok_xai_api_key_here') {
            throw new Error("AI key is missing or is placeholder.");
        }

        let apiUrl = 'https://api.x.ai/v1/chat/completions';
        let model = 'grok-beta';

        if (apiKey.startsWith('gsk_')) {
            apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
            model = 'llama-3.3-70b-versatile';
        }

        const systemPrompt = `You are a financial data extractor. Your task is to extract bank transactions from the provided bank statement text.
Return ONLY a valid JSON array of transaction objects. Do not include any explanation or markdown formatting outside the JSON.
Each object must have the following fields:
- date: String in YYYY-MM-DD format.
- description: String, transaction description/remarks.
- amount: Number, positive value of the transaction.
- type: String, either 'income' or 'expense'.
- currency: String, the currency of the transaction (e.g. 'USD', 'INR', 'EUR', etc. Default to the user's currency: ${userCurrency}).

Example output:
[
  {
    "date": "2026-06-01",
    "description": "Salary Credit",
    "amount": 5000,
    "type": "income",
    "currency": "USD"
  }
]`;

        const response = await axios.post(apiUrl, {
            model: model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Please extract transactions from this bank statement text:\n\n${pdfText}` }
            ],
            temperature: 0.1
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 20000
        });

        const content = response.data.choices[0].message.content.trim();
        const jsonStr = content.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
        const result = JSON.parse(jsonStr);
        return Array.isArray(result) ? result : (result.transactions || []);
    } catch (error) {
        console.error('Error parsing PDF with AI:', error.message);
        throw error;
    }
};

const parsePDFWithRegex = (text, userCurrency) => {
    const transactions = [];
    const lines = text.split('\n');
    
    // Regular expression to match dates like 2026-06-23, 23/06/2026, 06/23/2026, 23-Jun-2026, etc.
    const dateRegex = /\b(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{1,2}[-\s][A-Za-z]{3,}[-\s]\d{2,4})\b/;
    
    // Regex for amounts (e.g., 1,234.56 or 1234.56 or -123.45)
    const amountRegex = /[-+]?\b\d{1,3}(?:,\d{3})*(?:\.\d{2})\b/;

    for (const line of lines) {
        const dateMatch = line.match(dateRegex);
        if (!dateMatch) continue;

        const dateStr = dateMatch[0];
        
        // Remove date from the line to parse description and amount
        const lineWithoutDate = line.replace(dateStr, '').trim();
        
        // Find amounts in the line
        const amountMatches = lineWithoutDate.match(amountRegex);
        if (!amountMatches || amountMatches.length === 0) continue;
        
        const amountStr = amountMatches[0];
        const cleanAmount = parseFloat(amountStr.replace(/,/g, ''));
        if (isNaN(cleanAmount) || cleanAmount === 0) continue;
        
        // Description is whatever is left
        const description = lineWithoutDate.replace(amountStr, '').replace(/\s+/g, ' ').trim() || 'PDF Transaction';
        
        // Normalize date to YYYY-MM-DD
        let normalizedDate = new Date().toISOString().split('T')[0];
        try {
            const parsedDate = new Date(dateStr);
            if (!isNaN(parsedDate.getTime())) {
                normalizedDate = parsedDate.toISOString().split('T')[0];
            }
        } catch (e) {}

        transactions.push({
            date: normalizedDate,
            description: description,
            amount: Math.abs(cleanAmount),
            type: cleanAmount < 0 ? 'expense' : 'income',
            currency: userCurrency
        });
    }
    
    return transactions;
};

module.exports = {
    parseCSV,
    parsePDF,
    parsePDFWithAI,
    parsePDFWithRegex,
    detectDuplicates,
    autoCategorize
};
