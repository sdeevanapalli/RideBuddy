const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const { initDB } = require('./lib/db');
const authMiddleware = require('./middleware/auth');
const segmentsRouter = require('./routes/segments');
const authRouter = require('./routes/auth');

dotenv.config();

// Initialize database
initDB();

const app = express();
app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(authMiddleware);

app.use('/api/segments', segmentsRouter);
app.use('/auth', authRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`RideBuddy backend listening on http://localhost:${PORT}`);
});
