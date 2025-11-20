import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';
import { customAlphabet } from 'nanoid';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// app.use(helmet({ contentSecurityPolicy: false }));

app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'",  "'unsafe-inline'","https://cdn.tailwindcss.com"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "img-src": ["'self'", "data:", "https:"],
        },
      },
    })
  );
  

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));


const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const CODE_REGEX = /^[A-Za-z0-9]{6,8}$/;

// 6-character generator (alphanumeric)
const nanoid = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  6
);

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL in environment. See .env.example');
  process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

/* Healthcheck */
app.get('/healthz', (req, res) => {
  res.json({ ok: true, version: '1.0' });
});

/* POST /api/links
   Body: { target_url: string, code?: string }
   201 -> created
   400 -> invalid input
   409 -> duplicate code
*/
app.post('/api/links', async (req, res) => {
  try {
    const { target_url, code: requestedCode } = req.body || {};

    if (!target_url || typeof target_url !== 'string') {
      return res.status(400).json({ error: 'target_url is required' });
    }

    // validate URL
    try {
      const parsed = new URL(target_url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).json({ error: 'target_url must be http or https' });
      }
    } catch (err) {
      return res.status(400).json({ error: 'target_url is not a valid URL' });
    }

    let code = requestedCode ? String(requestedCode).trim() : null;

    if (code) {
      if (!CODE_REGEX.test(code)) {
        return res.status(400).json({ error: 'code must match /^[A-Za-z0-9]{6,8}$/' });
      }
    } else {
      // generate until unique (rare)
      let attempts = 0;
      do {
        code = nanoid();
        const exists = (await pool.query('SELECT 1 FROM links WHERE code = $1', [code])).rowCount > 0;
        if (!exists) break;
        attempts++;
      } while (attempts < 5);
      // if still colliding, allow DB to return unique violation and handle
    }

    // Insert (handle duplicate)
    try {
      const insert = await pool.query(
        `INSERT INTO links(code, target_url) VALUES($1, $2)
         RETURNING code, target_url, clicks, created_at, last_clicked`,
        [code, target_url]
      );
      return res.status(201).json(insert.rows[0]);
    } catch (err) {
      // unique violation code for Postgres is 23505
      if (err?.code === '23505') {
        return res.status(409).json({ error: 'code already exists' });
      }
      console.error('DB insert error', err);
      return res.status(500).json({ error: 'internal error' });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'internal error' });
  }
});

/* GET /api/links - list all links, optional ?q= search by code or url */
app.get('/api/links', async (req, res) => {
  try {
    const q = req.query.q;

    console.log("The q is: ",q)
    
    let sql = 'SELECT code, target_url, clicks, last_clicked, created_at FROM links';
    const params = [];
    if (q) {
      sql += ' WHERE code ILIKE $1 OR target_url ILIKE $1';
      params.push(`%${q}%`);
    }
    sql += ' ORDER BY created_at DESC';
    const r = await pool.query(sql, params);
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  }
});

/* GET /api/links/:code - stats for a single code */
app.get('/api/links/:code', async (req, res) => {
  const code = req.params.code;
  if (!CODE_REGEX.test(code)) {
    return res.status(400).json({ error: 'invalid code format' });
  }
  try {
    const r = await pool.query(
      'SELECT code, target_url, clicks, last_clicked, created_at FROM links WHERE code = $1',
      [code]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  }
});

/* DELETE /api/links/:code */
app.delete('/api/links/:code', async (req, res) => {
  const code = req.params.code;
  if (!CODE_REGEX.test(code)) {
    return res.status(400).json({ error: 'invalid code format' });
  }
  try {
    const r = await pool.query('DELETE FROM links WHERE code = $1 RETURNING code', [code]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'not found' });
    return res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  }
});


// Homepage  
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });


// Stats HTML page  
app.get('/code/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'code.html'));
});

/* Redirect handler for code
   - 302 redirect if found 
   - 404 if not found
*/

app.get('/:code', async (req, res, next) => {
  const code = req.params.code;
  // If code doesn't match expected pattern
  if (!CODE_REGEX.test(code)) return next();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sel = await client.query('SELECT target_url, clicks FROM links WHERE code = $1 FOR UPDATE', [code]);
    if (sel.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).send('Not found');
    }

    const { target_url, clicks } = sel.rows[0];
    const now = new Date();

    await client.query('UPDATE links SET clicks = $1, last_clicked = $2 WHERE code = $3', [Number(clicks) + 1, now, code]);

    await client.query('COMMIT');

    return res.redirect(302, target_url);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Redirect error', err);
    return res.status(500).send('Internal error');
  } finally {
    client.release();
  }
});

app.use((req, res) => {
  res.status(404).send('Not found');
});

app.listen(PORT, () => {
  console.log(`TinyLink running on port ${PORT} (BASE_URL=${BASE_URL})`);
});
