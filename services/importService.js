'use strict';

const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const pdf = require('pdf-parse');
const axios = require('axios');
const { Transaction, Category } = require('../models');

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalise any date string into YYYY-MM-DD.
 * Handles: DD/MM/YYYY, MM/DD/YYYY, DD-Mon-YY, ISO, etc.
 */
const normalizeDate = (raw) => {
    if (!raw) return null;
    const s = raw.toString().trim();
    if (!s || s.includes('#')) return null;

    // Already ISO
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    // DD/MM/YYYY or DD-MM-YYYY (day first – common in India/UK)
    const dmyFull = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
    if (dmyFull) {
        const [, d, m, y] = dmyFull;
        const candidate = new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`);
        if (!isNaN(candidate)) return candidate.toISOString().split('T')[0];
    }

    // DD/MM/YY
    const dmyShort = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})$/);
    if (dmyShort) {
        const [, d, m, y] = dmyShort;
        const year = parseInt(y) > 50 ? '19' + y : '20' + y;
        const candidate = new Date(`${year}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`);
        if (!isNaN(candidate)) return candidate.toISOString().split('T')[0];
    }

    // DD Mon YYYY  or  DD-Mon-YYYY  or  DD Mon YY (e.g. "24 Jun 2026", "24-Jun-26")
    const monNameFull = s.match(/^(\d{1,2})[\s\-\/]([A-Za-z]{3,9})[\s\-\/,]+(\d{2,4})$/);
    if (monNameFull) {
        const candidate = new Date(`${monNameFull[2]} ${monNameFull[1]}, ${monNameFull[3]}`);
        if (!isNaN(candidate)) return candidate.toISOString().split('T')[0];
    }

    // Mon DD, YYYY  (e.g. "Jun 24, 2026")
    const monDayYear = s.match(/^([A-Za-z]{3,9})[\s\-\.]+(\d{1,2})[,\s]+(\d{4})$/);
    if (monDayYear) {
        const candidate = new Date(`${monDayYear[1]} ${monDayYear[2]}, ${monDayYear[3]}`);
        if (!isNaN(candidate)) return candidate.toISOString().split('T')[0];
    }

    // Generic JS Date parse (last resort)
    const generic = new Date(s);
    if (!isNaN(generic)) return generic.toISOString().split('T')[0];

    return null;
};

/**
 * Parse a raw amount string into a float (handles commas, currency symbols, spaces).
 */
const parseAmount = (val) => {
    if (val === undefined || val === null) return 0;
    const clean = val.toString().replace(/[^0-9.\-]/g, '');
    return clean ? parseFloat(clean) : 0;
};

/**
 * Strip BOM + trim a header string.
 */
const cleanHeader = (h) => h.toString().trim().replace(/^\uFEFF/, '').replace(/['"]/g, '');

// ─────────────────────────────────────────────────────────────────────────────
// CSV PARSING  (Universal – handles any bank format)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect which column key best matches a set of search terms.
 * Returns the matched key or undefined.
 */
const findColumn = (keys, terms) => {
    const lowerKeys = keys.map(k => ({ original: k, lower: cleanHeader(k).toLowerCase() }));
    // Exact match first
    for (const t of terms) {
        const exact = lowerKeys.find(k => k.lower === t.toLowerCase());
        if (exact) return exact.original;
    }
    // Substring match second
    for (const t of terms) {
        const sub = lowerKeys.find(k => k.lower.includes(t.toLowerCase()));
        if (sub) return sub.original;
    }
    return undefined;
};

/**
 * Parse any CSV file and return normalised transaction objects.
 * Handles:
 *  - Standard: Date, Description, Amount, Type
 *  - Debit/Credit split columns (most Indian/UK banks)
 *  - Signed single amount column (negative = expense)
 *  - Any date format
 *  - BOM headers
 *  - Quoted fields, mixed delimiters (comma, semicolon, tab, pipe)
 *  - Skips non-data header rows at the top
 */
const parseCSV = (filePath, userCurrency = 'USD') => {
    return new Promise((resolve, reject) => {
        try {
            // Read file as UTF-8 (handle BOM)
            let content = fs.readFileSync(filePath, 'utf-8');
            if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);

            // Auto-detect delimiter
            const firstLine = content.split('\n')[0];
            let delimiter = ',';
            const counts = {
                ',': (firstLine.match(/,/g) || []).length,
                ';': (firstLine.match(/;/g) || []).length,
                '\t': (firstLine.match(/\t/g) || []).length,
                '|': (firstLine.match(/\|/g) || []).length,
            };
            delimiter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];

            // Parse with PapaParse
            const parsed = Papa.parse(content, {
                header: false,          // We'll find the header row ourselves
                delimiter,
                skipEmptyLines: 'greedy',
                transformHeader: cleanHeader,
            });

            if (!parsed.data || parsed.data.length === 0) {
                return resolve([]);
            }

            // ── Find the real header row ──────────────────────────────────────
            // Walk rows until we find one containing a date-like or amount-like column name
            const headerKeywords = [
                'date', 'value date', 'posting date', 'transaction date',
                'amount', 'debit', 'credit', 'withdrawal', 'deposit',
                'description', 'particulars', 'narration', 'details', 'remarks',
            ];
            let headerRowIdx = 0;
            for (let i = 0; i < Math.min(parsed.data.length, 20); i++) {
                const row = parsed.data[i];
                const cellsLower = row.map(c => (c || '').toString().toLowerCase().trim());
                const matches = headerKeywords.filter(kw => cellsLower.some(c => c.includes(kw)));
                if (matches.length >= 2) { headerRowIdx = i; break; }
            }

            const headers = parsed.data[headerRowIdx].map(cleanHeader);
            const dataRows = parsed.data.slice(headerRowIdx + 1);

            console.log(`[CSV] Header row at index ${headerRowIdx}:`, headers);

            // ── Map headers to known column types ────────────────────────────
            const dateKey   = findColumn(headers, ['date', 'value date', 'txn date', 'transaction date', 'posting date', 'trans date', 'valuedate']);
            const descKey   = findColumn(headers, ['description', 'narration', 'particulars', 'remarks', 'details', 'memo', 'transaction details', 'trans desc', 'transaction description', 'narrative']);
            const debitKey  = findColumn(headers, ['debit', 'withdrawal', 'dr', 'paid out', 'withdrawals', 'debit amount', 'withdrawal amt', 'debit(inr)', 'debit (inr)']);
            const creditKey = findColumn(headers, ['credit', 'deposit', 'cr', 'paid in', 'deposits', 'credit amount', 'deposit amt', 'credit(inr)', 'credit (inr)']);
            const amtKey    = findColumn(headers, ['amount', 'transaction amount', 'trans amount', 'amt', 'value', 'net amount']);
            const typeKey   = findColumn(headers, ['type', 'transaction type', 'trans type', 'dr/cr', 'debit/credit']);
            const catKey    = findColumn(headers, ['category', 'group', 'tag', 'classification']);

            console.log(`[CSV] Detected columns → date:${dateKey} desc:${descKey} debit:${debitKey} credit:${creditKey} amt:${amtKey} type:${typeKey}`);

            const transactions = [];

            for (const row of dataRows) {
                // Convert array row back to object using detected headers
                const obj = {};
                headers.forEach((h, i) => { obj[h] = (row[i] || '').toString().trim(); });

                // ── Date ──────────────────────────────────────────────────────
                const rawDate = dateKey ? obj[dateKey] : null;
                const date = normalizeDate(rawDate);
                if (!date) continue; // Skip rows without a valid date

                // ── Description ───────────────────────────────────────────────
                const description = (descKey ? obj[descKey] : '') || 'Imported Transaction';
                if (!description.trim()) continue;

                // ── Amount & Type ─────────────────────────────────────────────
                let amount = 0;
                let type = 'expense';

                const dVal = debitKey  ? parseAmount(obj[debitKey])  : 0;
                const cVal = creditKey ? parseAmount(obj[creditKey]) : 0;
                const aVal = amtKey    ? parseAmount(obj[amtKey])    : 0;

                if (dVal !== 0 || cVal !== 0) {
                    // Separate debit/credit columns
                    if (dVal > 0) { amount = dVal; type = 'expense'; }
                    else if (cVal > 0) { amount = cVal; type = 'income'; }
                    else if (dVal < 0) { amount = Math.abs(dVal); type = 'income'; } // reversed sign
                    else if (cVal < 0) { amount = Math.abs(cVal); type = 'expense'; }
                } else if (aVal !== 0) {
                    amount = Math.abs(aVal);
                    // Check a type column if present
                    if (typeKey) {
                        const tv = obj[typeKey].toLowerCase();
                        type = (tv.includes('cr') || tv.includes('credit') || tv.includes('deposit') || tv.includes('income')) ? 'income' : 'expense';
                    } else {
                        type = aVal < 0 ? 'expense' : 'income';
                    }
                }

                if (amount === 0) continue; // Skip zero-amount rows

                transactions.push({
                    date,
                    description: description.trim(),
                    csvCategory: catKey ? obj[catKey] : '',
                    amount: parseFloat(amount.toFixed(2)),
                    type,
                    currency: userCurrency,
                });
            }

            console.log(`[CSV] Extracted ${transactions.length} valid transactions`);
            resolve(transactions);
        } catch (err) {
            reject(err);
        }
    });
};

// ─────────────────────────────────────────────────────────────────────────────
// PDF PARSING  (Universal – AI primary, robust regex fallback)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract raw text from a PDF buffer.
 * Returns { text, pageCount }.
 */
const parsePDF = async (filePath) => {
    const buffer = fs.readFileSync(filePath);
    try {
        const data = await pdf(buffer, {
            // Preserve more formatting so regex has a better chance
            normalizeWhitespace: false,
            disableCombineTextItems: false,
        });
        return data.text;
    } catch (err) {
        console.error('[PDF] pdf-parse failed:', err.message);
        return '';
    }
};

/**
 * Use Groq / xAI to extract transactions from raw PDF text.
 */
const parsePDFWithAI = async (pdfText, userCurrency) => {
    const apiKey = process.env.XAI_API_KEY ? process.env.XAI_API_KEY.trim() : null;
    if (!apiKey || apiKey === 'your_grok_xai_api_key_here') {
        throw new Error('AI API key is missing or is a placeholder.');
    }

    let apiUrl = 'https://api.x.ai/v1/chat/completions';
    let model  = 'grok-beta';

    if (apiKey.startsWith('gsk_')) {
        apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
        model  = 'llama-3.3-70b-versatile';
    }

    // Truncate text if too long (API limits)
    const MAX_CHARS = 12000;
    const truncated = pdfText.length > MAX_CHARS
        ? pdfText.slice(0, MAX_CHARS) + '\n[... text truncated ...]'
        : pdfText;

    const systemPrompt = `You are a financial data extractor specializing in bank statements from any country.
Extract ALL transactions from the provided bank statement text and return ONLY a valid JSON array.
Do NOT include any explanation, markdown, or text outside the JSON array.

Each object must have:
- "date": "YYYY-MM-DD"
- "description": string (transaction narration)
- "amount": positive number
- "type": "income" or "expense"
- "currency": "${userCurrency}" (use this unless clearly stated otherwise)

Rules:
- Credits / deposits / salary / refunds → type "income"
- Debits / withdrawals / payments / purchases → type "expense"
- Ignore balance rows, header rows, subtotals
- Return [] if no transactions found`;

    const response = await axios.post(apiUrl, {
        model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: `Extract transactions from this bank statement:\n\n${truncated}` },
        ],
        temperature: 0.1,
    }, {
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        timeout: 30000,
    });

    const content = response.data.choices[0].message.content.trim();
    // Strip markdown code fences if present
    const jsonStr = content
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/, '')
        .trim();

    const result = JSON.parse(jsonStr);
    return Array.isArray(result) ? result : (result.transactions || []);
};

/**
 * Universal regex-based PDF parser.
 * Works for multi-column table formats used by most banks worldwide.
 */
const parsePDFWithRegex = (text, userCurrency = 'USD') => {
    const transactions = [];
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    // Common date patterns
    const datePatterns = [
        /\b(\d{4}[-\/\.]\d{2}[-\/\.]\d{2})\b/,                          // YYYY-MM-DD
        /\b(\d{2}[-\/\.]\d{2}[-\/\.]\d{4})\b/,                          // DD-MM-YYYY or MM-DD-YYYY
        /\b(\d{2}[-\/\.]\d{2}[-\/\.]\d{2})\b/,                          // DD-MM-YY
        /\b(\d{1,2}[\s\-](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s\-,]+\d{2,4})\b/i, // DD Mon YYYY
        /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s\-\.]+\d{1,2}[,\s]+\d{4})\b/i, // Mon DD, YYYY
    ];

    // Amount pattern: optional sign, digits with commas, mandatory decimal
    const amountPattern = /([+-]?\s*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})|[+-]?\s*\d+\.\d{1,2})/g;

    // Skip lines that are obviously headers or footers
    const skipKeywords = ['statement', 'account number', 'account no', 'opening balance', 'closing balance',
                          'total', 'page', 'branch', 'ifsc', 'swift', 'sort code', 'bic'];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineLower = line.toLowerCase();

        if (skipKeywords.some(kw => lineLower.startsWith(kw) || lineLower === kw)) continue;

        // Find date in line
        let dateStr = null;
        let dateMatchStr = '';
        for (const pat of datePatterns) {
            const m = line.match(pat);
            if (m) { dateStr = normalizeDate(m[1] || m[0]); dateMatchStr = m[0]; break; }
        }
        if (!dateStr) continue;

        // Find all amounts in the line (after removing the date)
        const lineWithoutDate = line.replace(dateMatchStr, '').trim();
        const amountMatches = [...lineWithoutDate.matchAll(amountPattern)];
        if (amountMatches.length === 0) continue;

        const numbers = amountMatches.map(m => parseFloat(m[0].replace(/,|\s/g, '')));

        // Description = everything that's not a date or a number
        let description = lineWithoutDate
            .replace(amountPattern, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
        if (!description) description = 'PDF Transaction';
        if (description.length < 2) continue;

        // Skip obvious non-transaction lines (balance only)
        if (/^(balance|bal\.?|closing|opening)\s*:?$/i.test(description)) continue;

        // Determine type & amount using heuristics
        let amount = 0;
        let type = 'expense';

        const incomeKeywords = ['credit', 'cr', 'deposit', 'salary', 'payroll', 'refund',
                                'interest', 'dividend', 'transfer in', 'received', 'income',
                                'reversal', 'cashback', 'reward'];
        const isIncomeLine = incomeKeywords.some(kw => lineLower.includes(kw));

        if (numbers.length >= 2) {
            // Try balance-diff approach: last number is running balance
            // Use the FIRST number as the transaction amount (most formats)
            amount = Math.abs(numbers[0]);
            // Override type based on keywords
            type = isIncomeLine ? 'income' : 'expense';
        } else {
            amount = Math.abs(numbers[0]);
            const rawNum = amountMatches[0][0].replace(/[\s,]/g, '');
            type = (rawNum.startsWith('+') || isIncomeLine) ? 'income' : 'expense';
        }

        if (amount === 0) continue;

        transactions.push({
            date: dateStr,
            description,
            amount: parseFloat(amount.toFixed(2)),
            type,
            currency: userCurrency,
        });
    }

    // Deduplicate: remove entries with identical date+amount+description
    const seen = new Set();
    const unique = transactions.filter(t => {
        const key = `${t.date}|${t.amount}|${t.description.slice(0, 30)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    console.log(`[PDF Regex] Extracted ${unique.length} transactions`);
    return unique;
};

// ─────────────────────────────────────────────────────────────────────────────
// DUPLICATE DETECTION
// ─────────────────────────────────────────────────────────────────────────────

const detectDuplicates = async (userId, transactions) => {
    const identifiedDuplicates = [];
    const uniqueTransactions   = [];

    for (const trans of transactions) {
        const normalizedDate = normalizeDate(trans.date) || trans.date;
        const existing = await Transaction.findOne({
            userId,
            amount: parseFloat(parseFloat(trans.amount).toFixed(2)),
            date:   normalizedDate,
            description: {
                $regex: `^${trans.description.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
                $options: 'i',
            },
        });

        if (existing) {
            identifiedDuplicates.push(trans);
        } else {
            uniqueTransactions.push({ ...trans, date: normalizedDate });
        }
    }

    return { uniqueTransactions, identifiedDuplicates };
};

// ─────────────────────────────────────────────────────────────────────────────
// AUTO CATEGORISE
// ─────────────────────────────────────────────────────────────────────────────

const autoCategorize = async (userId, transactions) => {
    const categories = await Category.find({ userId });
    const processed  = [...transactions];

    // Expanded keyword map covering Indian + global merchants
    const keywordMap = {
        // Food & Dining
        'zomato': 'Food', 'swiggy': 'Food', 'dominos': 'Food', 'pizza': 'Food',
        'mcdonald': 'Food', 'burger': 'Food', 'kfc': 'Food', 'starbucks': 'Food',
        'cafe': 'Food', 'restaurant': 'Food', 'hotel food': 'Food',
        // Groceries
        'walmart': 'Groceries', 'bigbasket': 'Groceries', 'grofer': 'Groceries',
        'dmart': 'Groceries', 'reliance fresh': 'Groceries', 'more supermarket': 'Groceries',
        'grocery': 'Groceries', 'supermarket': 'Groceries',
        // Shopping
        'amazon': 'Shopping', 'flipkart': 'Shopping', 'myntra': 'Shopping',
        'ajio': 'Shopping', 'target': 'Shopping', 'mall': 'Shopping',
        // Entertainment
        'netflix': 'Entertainment', 'spotify': 'Entertainment', 'youtube': 'Entertainment',
        'hotstar': 'Entertainment', 'prime video': 'Entertainment', 'jiocinema': 'Entertainment',
        'bookmyshow': 'Entertainment', 'cinema': 'Entertainment',
        // Transport
        'uber': 'Transport', 'ola': 'Transport', 'lyft': 'Transport',
        'rapido': 'Transport', 'metro': 'Transport', 'irctc': 'Transport',
        'indigo': 'Transport', 'air india': 'Transport', 'makemytrip': 'Transport',
        'petrol': 'Transport', 'fuel': 'Transport',
        // Utilities
        'electric': 'Utilities', 'water bill': 'Utilities', 'internet': 'Utilities',
        'broadband': 'Utilities', 'airtel': 'Utilities', 'jio': 'Utilities',
        'bsnl': 'Utilities', 'vi ': 'Utilities', 'vodafone': 'Utilities',
        'bescom': 'Utilities', 'gas bill': 'Utilities',
        // Housing
        'rent': 'Housing', 'apartment': 'Housing', 'mortgage': 'Housing', 'nobroker': 'Housing',
        // Income
        'salary': 'Salary', 'payroll': 'Salary', 'depo': 'Salary',
        'dividend': 'Salary', 'credit from': 'Salary',
        // Health
        'pharmacy': 'Health', 'hospital': 'Health', 'clinic': 'Health',
        'medical': 'Health', 'apollo': 'Health', 'practo': 'Health',
        // Education
        'school': 'Education', 'college': 'Education', 'university': 'Education',
        'course': 'Education', 'udemy': 'Education', 'coursera': 'Education',
    };

    for (let i = 0; i < processed.length; i++) {
        const trans = processed[i];
        let found = null;

        // 1. CSV already has a category matching DB
        if (trans.csvCategory) {
            found = categories.find(c => c.name.toLowerCase() === trans.csvCategory.toLowerCase());
        }

        // 2. Description contains a category name
        if (!found) {
            found = categories.find(c =>
                trans.description.toLowerCase().includes(c.name.toLowerCase())
            );
        }

        // 3. Keyword map fallback
        if (!found) {
            const descLower = trans.description.toLowerCase();
            const keyword   = Object.keys(keywordMap).find(k => descLower.includes(k));
            if (keyword) {
                found = categories.find(c =>
                    c.name.toLowerCase() === keywordMap[keyword].toLowerCase()
                );
            }
        }

        if (found) trans.categoryId = found._id.toString();
    }

    return processed;
};

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
    parseCSV,
    parsePDF,
    parsePDFWithAI,
    parsePDFWithRegex,
    detectDuplicates,
    autoCategorize,
    normalizeDate,
};
