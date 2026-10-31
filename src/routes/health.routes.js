import express from 'express';
import { config } from '../config/env.js';

const router = express.Router();

router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    environment: config.nodeEnv,
    storageBackend: config.supabase.isConfigured ? 'supabase' : 'local-fallback'
  });
});

export default router;
