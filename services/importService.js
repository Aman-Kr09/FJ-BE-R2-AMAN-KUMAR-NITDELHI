const fs = require('fs');
const csv = require('csv-parser');
const pdf = require('pdf-parse');
const axios = require('axios');
const { Transaction, Category } = require('../models');
const { getAIResponse } = require('./aiService');

const parseCSV = (filePath) => {
    return new Promise((resolve, reject) => {
        const readline = require('readline');
        
        // 1. Read all lines to detect separator and locate the header row
        const stream = fs.createReadStream(filePath);
        const rl = readline.createInterface({
            input: stream,
            crlfDelay: Infinity
        });

        const lines = [];
        rl.on('line', (line) => {
            lines.push(line);
        });

        rl.on('close', () => {
            if (lines.length === 0) {
                return resolve([]);
            }

            // 2. Detect delimiter
            let separator = ',';
            const commaCount = lines.slice(0, 10).reduce((acc, l) => acc + (l.match(/,/g) || []).length, 0);
            const semicolonCount = lines.slice(0, 10).reduce((acc, l) => acc + (l.match(/;/g) || []).length, 0);
            const tabCount = lines.slice(0, 10).reduce((acc, l) => acc + (l.match(/\t/g) || []).length, 0);

            if (semicolonCount > commaCount && semicolonCount > tabCount) {
                separator = ';';
            } else if (tabCount > commaCount && tabCount > semicolonCount) {
                separator = '\t';
            }

            // 3. Find the header line index
            const headerKeywords = ['date', 'desc', 'particulars', 'remarks', 'trans', 'amount', 'value', 'debit', 'credit', 'withdrawal', 'deposit', 'narration', 'amt'];
            let headerIndex = 0;
            
            for (let i = 0; i < Math.min(lines.length, 20); i++) {
                const columns = lines[i].split(separator).map(col => col.trim().toLowerCase());
                const matchCount = columns.filter(col => 
                    headerKeywords.some(kw => col.includes(kw))
                ).length;
                
                if (matchCount >= 2) {
                    headerIndex = i;
                    break;
                }
            }

            // 4. Create a clean CSV content string starting from the header line
            const cleanCSVContent = lines.slice(headerIndex).join('\n');

            // 5. Parse using csv-parser
            const results = [];
            const { Readable } = require('stream');
            const cleanStream = Readable.from([cleanCSVContent]);

            cleanStream
                .pipe(csv({
                    separator: separator,
                    mapHeaders: ({ header }) => header.trim().replace(/^\ufeff/, '')
                }))
                .on('data', (data) => results.push(data))
                .on('end', () => resolve(results))
                .on('error', (error) => reject(error));
        });
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
    
    const dateRegex = /\b(\d{4}[-/. ]\d{1,2}[-/. ]\d{1,2}|\d{1,2}[-/. ]\d{1,2}[-/. ]\d{2,4}|\d{1,2}[-\s][A-Za-z]{3,}[-,\s]+\d{2,4}|[A-Za-z]{3,}[-\s]\d{1,2}[-,\s]+\d{2,4})\b/;
    const amountRegex = /[-+]?\b\d{1,3}(?:,\d{3})*(?:\.\d{2})\b/g;

    let runningBalance = null;

    for (const line of lines) {
        const dateMatch = line.match(dateRegex);
        if (!dateMatch) continue;

        const dateStr = dateMatch[0];
        
        // Find all decimal amounts on the line
        const lineWithoutDate = line.replace(dateStr, '').trim();
        const amountMatches = lineWithoutDate.match(amountRegex) || [];
        
        if (amountMatches.length === 0) continue;
        
        const numbers = amountMatches.map(m => parseFloat(m.replace(/,/g, '')));
        
        // Normalize date to YYYY-MM-DD
        let normalizedDate = new Date().toISOString().split('T')[0];
        try {
            const parsedDate = new Date(dateStr);
            if (!isNaN(parsedDate.getTime())) {
                normalizedDate = parsedDate.toISOString().split('T')[0];
            }
        } catch (e) {}

        const description = lineWithoutDate.replace(amountRegex, '').replace(/\s+/g, ' ').trim() || 'PDF Transaction';

        // Set starting balance if it is the "Previous balance" line
        if (description.toLowerCase().includes('previous balance')) {
            runningBalance = numbers[numbers.length - 1];
            continue;
        }

        // If we have at least 2 numbers (amount and balance) and running balance is established
        if (numbers.length >= 2 && runningBalance !== null) {
            const parsedBalance = numbers[numbers.length - 1];
            
            // Calculate change in balance
            const balanceChange = parseFloat((parsedBalance - runningBalance).toFixed(2));
            const type = balanceChange < 0 ? 'expense' : 'income';
            
            transactions.push({
                date: normalizedDate,
                description: description,
                amount: Math.abs(balanceChange),
                type: type,
                currency: userCurrency || 'USD'
            });
            
            runningBalance = parsedBalance;
        } else if (numbers.length >= 1) {
            // Fallback: Use the first decimal number found as the transaction amount
            const amt = Math.abs(numbers[0]);
            let type = 'expense';
            const lowercaseDesc = description.toLowerCase();
            if (lowercaseDesc.includes('deposit') || lowercaseDesc.includes('payroll') || lowercaseDesc.includes('refund') || lowercaseDesc.includes('interest')) {
                type = 'income';
            }
            
            transactions.push({
                date: normalizedDate,
                description: description,
                amount: amt,
                type: type,
                currency: userCurrency || 'USD'
            });
            
            if (runningBalance !== null) {
                runningBalance += (type === 'income' ? amt : -amt);
            }
        }
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
