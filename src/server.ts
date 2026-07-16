import express from 'express';
import cors from 'cors';
import { apiRouter } from './routes/api.router.js';

const app = express();

app.use(cors());
app.use(
  express.json({
    limit: '5mb',
  }),
);
app.use('/api', apiRouter);

const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
  console.log(`ClubLectura backend escuchando en http://localhost:${port}`);
});
