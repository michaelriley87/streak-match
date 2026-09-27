import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createFeed } from './src/espn.js';

const feed = createFeed();
const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']],
  ['/time.js', ['time.js', 'text/javascript']],
]);
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    if (path === '/api/games') {
      const data = await feed();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
      return;
    }
    const file = files.get(path);
    if (!file) { res.writeHead(404).end('Not found'); return; }
    const body = await readFile(new URL(`./public/${file[0]}`, import.meta.url));
    res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  } catch (error) {
    console.error(error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unable to load games. Please try again.' }));
  }
});
server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1', () => console.log(`Streak Match running at http://localhost:${server.address().port}`));
