import express from 'express';
import fs from 'fs';
import path from 'path';

const PORT = Number(process.env.PORT) || 3000;
const TEMPLATES_DIR = path.resolve(process.cwd(), 'templates');

function ensureTemplatesDir(): void {
  try {
    if (!fs.existsSync(TEMPLATES_DIR)) {
      fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
    }
  } catch (err) {
    console.warn('Could not create templates directory:', err);
  }
}

function sanitizeFileName(raw: string): string {
  const base = path.basename(raw).replace(/[^a-zA-Z0-9._-]/g, '_');
  const withExt = base.endsWith('.json') ? base : `${base}.json`;
  return withExt.replace(/^\.+/, '') || 'template.json';
}

async function startServer(): Promise<void> {
  ensureTemplatesDir();

  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // Health check endpoint for Cloud Run readiness
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // List all templates stored in /templates
  app.get('/api/templates', (_req, res) => {
    try {
      ensureTemplatesDir();
      if (!fs.existsSync(TEMPLATES_DIR)) {
        res.json({ templates: [] });
        return;
      }

      const files = fs
        .readdirSync(TEMPLATES_DIR)
        .filter((f) => f.endsWith('.json'))
        .sort();

      const templates = files
        .map((fileName) => {
          try {
            const content = fs.readFileSync(path.join(TEMPLATES_DIR, fileName), 'utf-8');
            const parsed = JSON.parse(content);
            const sheets = Array.isArray(parsed.sheets) ? parsed.sheets : [];
            const compCount = sheets.reduce(
              (sum: number, s: { components?: unknown[] }) =>
                sum + (Array.isArray(s.components) ? s.components.length : 0),
              0
            );
            const title: string = parsed?.metadata?.title || fileName.replace(/\.json$/, '');
            const upper = `${fileName} ${title}`.toUpperCase();
            const category = upper.includes('VFD')
              ? 'VFD'
              : upper.includes('PLC')
                ? 'PLC'
                : upper.includes('MOTOR') || upper.includes('FORWARD')
                  ? 'Motor Control'
                  : 'Imported PDF';

            return {
              id: parsed.id || fileName,
              fileName,
              title,
              category,
              description: parsed?.metadata?.description || 'VoltGrid ECAD schematic template',
              sheetCount: sheets.length,
              componentCount: compCount,
              source: 'disk' as const,
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      res.json({ templates });
    } catch (err) {
      res.status(500).json({ error: 'Failed to list templates', details: String(err) });
    }
  });

  // Fetch a specific template JSON from /templates
  app.get('/api/templates/:fileName', (req, res) => {
    const safeName = sanitizeFileName(req.params.fileName);
    const fullPath = path.resolve(TEMPLATES_DIR, safeName);
    if (!fullPath.startsWith(TEMPLATES_DIR + path.sep) || !fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      res.type('application/json').send(content);
    } catch (err) {
      res.status(500).json({ error: 'Failed to read template', details: String(err) });
    }
  });

  // Save an imported PDF or user-created template into /templates
  app.post('/api/templates', (req, res) => {
    const { fileName, project } = req.body ?? {};
    if (!fileName || typeof fileName !== 'string' || !project || !Array.isArray(project.sheets)) {
      res.status(400).json({ error: 'Invalid template payload: fileName and project.sheets required.' });
      return;
    }
    const safeName = sanitizeFileName(fileName);
    const fullPath = path.resolve(TEMPLATES_DIR, safeName);
    if (!fullPath.startsWith(TEMPLATES_DIR + path.sep)) {
      res.status(400).json({ error: 'Invalid file name.' });
      return;
    }
    try {
      ensureTemplatesDir();
      fs.writeFileSync(fullPath, JSON.stringify(project, null, 2), 'utf-8');
      res.status(201).json({ ok: true, fileName: safeName, path: `/templates/${safeName}` });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save template', details: String(err) });
    }
  });

  // Serve raw template JSON files for direct download
  app.use('/templates', express.static(TEMPLATES_DIR));

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VoltGrid ECAD server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start VoltGrid ECAD server:', err);
  process.exit(1);
});
