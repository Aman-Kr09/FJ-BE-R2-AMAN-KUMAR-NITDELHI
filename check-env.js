require('dotenv').config();
console.log('PORT:', process.env.PORT);
console.log('DB_HOST:', process.env.DB_HOST);
console.log('XAI_API_KEY:', process.env.XAI_API_KEY ? 'Present' : 'MISSING');
