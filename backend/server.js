const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const segmentsRouter = require('./routes/segments');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/segments', segmentsRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`RideBuddy backend listening on http://localhost:${PORT}`);
});
